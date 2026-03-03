import {
  type AgentInstanceManager,
  createSpanTypePrefixer,
  getLogger,
  SpanContext,
  SpanType,
  serializeValue,
  type Tracer,
} from '@prefactor/core';
import { extractTokenUsage } from './metadata-extractor.js';

const toLangchainSpanType = createSpanTypePrefixer('langchain');
const logger = getLogger('middleware');

/**
 * Prefactor middleware for LangChain.js agents.
 *
 * This middleware automatically traces LLM calls, tool executions, and agent workflows.
 * It integrates with LangChain.js middleware API to provide transparent instrumentation.
 *
 * Features:
 * - Automatic parent-child span relationships via context propagation
 * - Token usage extraction for LLM calls
 * - Error tracking and debugging
 * - Zero-overhead instrumentation (graceful failure)
 *
 * @example
 * ```typescript
 * import { init } from '@prefactor/langchain';
 * import { createReactAgent } from '@langchain/langgraph/prebuilt';
 *
 * const middleware = init();
 * const agent = createReactAgent({
 *   llm: model,
 *   tools: [myTool],
 *   middleware: [middleware],
 * });
 * ```
 */
export class PrefactorMiddleware {
  private agentInstanceStarted = false;

  constructor(
    private tracer: Tracer,
    private agentManager: AgentInstanceManager,
    private agentInfo?: Parameters<AgentInstanceManager['startInstance']>[0]
  ) {}

  /**
   * Called before agent execution starts
   *
   * @param state - Agent state containing messages
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain state can be any structure
  async beforeAgent(_state: any): Promise<void> {
    this.ensureAgentInstanceStarted();
  }

  /**
   * Called after agent execution completes
   *
   * @param state - Agent state containing messages
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain state can be any structure
  async afterAgent(state: any): Promise<void> {
    // Root agent spans are intentionally not emitted.
    void state;
  }

  shutdown(): void {
    this.finishAgentInstance();
  }

  /**
   * Wrap a model call to trace LLM invocations
   *
   * @param request - Model invocation request
   * @param handler - The actual model call function
   * @returns Promise resolving to the model response
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain request/handler types are dynamic
  async wrapModelCall<T>(request: any, handler: (req: any) => Promise<T>): Promise<T> {
    this.ensureAgentInstanceStarted();

    const modelName = this.extractModelName(request);
    const span = this.tracer.startSpan({
      name: 'langchain:llm-call',
      spanType: toLangchainSpanType(SpanType.LLM),
      inputs: {
        ...this.extractModelInputs(request),
        'langchain.model.name': modelName,
      },
    });

    try {
      const response = await SpanContext.runAsync(span, () => handler(request));

      const outputs = this.extractModelOutputs(response);
      const tokenUsage = extractTokenUsage(response);

      this.tracer.endSpan(span, { outputs, tokenUsage: tokenUsage ?? undefined });
      return response;
    } catch (error) {
      this.tracer.endSpan(span, { error: error as Error });
      throw error;
    }
  }

  /**
   * Wrap a tool call to trace tool executions
   *
   * @param request - Tool invocation request
   * @param handler - The actual tool call function
   * @returns Promise resolving to the tool response
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain request/handler types are dynamic
  async wrapToolCall<T>(request: any, handler: (req: any) => Promise<T>): Promise<T> {
    this.ensureAgentInstanceStarted();

    const toolName = this.extractToolName(request);
    const span = this.tracer.startSpan({
      name: 'langchain:tool-call',
      spanType: toLangchainSpanType(SpanType.TOOL),
      inputs: {
        ...this.extractToolInputs(request),
        'langchain.tool.name': toolName,
      },
    });

    try {
      const response = await SpanContext.runAsync(span, () => handler(request));

      this.tracer.endSpan(span, {
        outputs: this.extractToolOutputs(response),
      });
      return response;
    } catch (error) {
      this.tracer.endSpan(span, { error: error as Error });
      throw error;
    }
  }

  /**
   * Extract model name from request
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain request structure is dynamic
  private extractModelName(request: any): string {
    const candidate = request?.model ?? request?.modelName;

    if (typeof candidate === 'string') {
      return candidate;
    }

    if (candidate && typeof candidate === 'object') {
      const modelObject = candidate as Record<string, unknown>;
      if (
        Array.isArray(modelObject.id) &&
        modelObject.id.every((item) => typeof item === 'string')
      ) {
        return (modelObject.id as string[]).join('.');
      }

      if (typeof modelObject.modelName === 'string') {
        return modelObject.modelName;
      }

      if (typeof modelObject.name === 'string') {
        return modelObject.name;
      }
    }

    return 'unknown';
  }

  /**
   * Extract model inputs from request
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain request structure is dynamic
  private extractModelInputs(request: any): Record<string, unknown> {
    const messages = request?.messages ?? [];
    return { messages: serializeValue(messages.slice(-3)) };
  }

  /**
   * Extract model outputs from response
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain response structure is dynamic
  private extractModelOutputs(response: any): Record<string, unknown> {
    const content = response?.content ?? response?.text ?? '';
    return { content: serializeValue(content) };
  }

  /**
   * Extract tool name from request
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain request structure is dynamic
  private extractToolName(request: any): string {
    return request?.name ?? request?.tool ?? 'unknown';
  }

  /**
   * Extract tool inputs from request
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain request structure is dynamic
  private extractToolInputs(request: any): Record<string, unknown> {
    return { input: request?.input ?? request?.args ?? {} };
  }

  /**
   * Extract tool outputs from response
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain response structure is dynamic
  private extractToolOutputs(response: any): Record<string, unknown> {
    return { output: response?.output ?? response };
  }

  private ensureAgentInstanceStarted(): void {
    if (this.agentInstanceStarted) {
      return;
    }

    try {
      this.agentManager.startInstance(this.agentInfo);
      this.agentInstanceStarted = true;
    } catch (error) {
      logger.error('Failed to start agent instance:', error);
    }
  }

  private finishAgentInstance(): void {
    if (!this.agentInstanceStarted) {
      return;
    }

    try {
      this.agentManager.finishInstance();
      this.agentInstanceStarted = false;
    } catch (error) {
      logger.error('Failed to finish agent instance:', error);
    }
  }
}
