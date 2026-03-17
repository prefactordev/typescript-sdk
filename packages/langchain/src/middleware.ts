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
import { resolveToolSpanType } from './schema.js';
import { createToolSpanInputs, createToolSpanOutputs } from './tool-span-contract.js';

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
    private agentInfo?: Parameters<AgentInstanceManager['startInstance']>[0],
    private toolSpanTypes?: Record<string, string>
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
      spanType: resolveToolSpanType(toolName, this.toolSpanTypes),
      inputs: createToolSpanInputs({
        toolName,
        input: this.extractToolInput(request),
      }),
    });

    try {
      const response = await SpanContext.runAsync(span, () => handler(request));

      this.tracer.endSpan(span, {
        outputs: createToolSpanOutputs(this.extractToolOutput(response)),
      });
      return response;
    } catch (error) {
      this.tracer.endSpan(span, {
        outputs: createToolSpanOutputs(undefined),
        error: error as Error,
      });
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

      if (typeof modelObject.model === 'string') {
        return modelObject.model;
      }

      if (typeof modelObject.name === 'string') {
        return modelObject.name;
      }

      const defaultConfig = modelObject.defaultConfig as { model?: unknown } | undefined;
      if (typeof defaultConfig?.model === 'string') {
        return defaultConfig.model;
      }

      const internalDefaultConfig = modelObject._defaultConfig as { model?: unknown } | undefined;
      if (typeof internalDefaultConfig?.model === 'string') {
        return internalDefaultConfig.model;
      }

      if (modelObject._modelInstanceCache instanceof Map) {
        for (const instance of modelObject._modelInstanceCache.values()) {
          if (!instance || typeof instance !== 'object') {
            continue;
          }

          const typedInstance = instance as {
            model?: unknown;
            modelName?: unknown;
            name?: unknown;
          };
          if (typeof typedInstance.modelName === 'string') {
            return typedInstance.modelName;
          }
          if (typeof typedInstance.model === 'string') {
            return typedInstance.model;
          }
          if (typeof typedInstance.name === 'string') {
            return typedInstance.name;
          }
        }
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
    if (typeof request?.toolCall?.name === 'string') {
      return request.toolCall.name;
    }

    if (typeof request?.tool?.name === 'string') {
      return request.tool.name;
    }

    if (typeof request?.name === 'string') {
      return request.name;
    }

    if (typeof request?.tool === 'string') {
      return request.tool;
    }

    return 'unknown';
  }

  /**
   * Extract tool inputs from request
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain request structure is dynamic
  private extractToolInput(request: any): unknown {
    if (request?.toolCall?.args !== undefined) {
      return request.toolCall.args;
    }

    if (request?.input !== undefined) {
      return request.input;
    }

    return request?.args;
  }

  /**
   * Extract tool outputs from response
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain response structure is dynamic
  private extractToolOutput(response: any): unknown {
    if (response?.output !== undefined) {
      return response.output;
    }

    const content = response?.content ?? response?.kwargs?.content;
    if (content !== undefined) {
      return this.normalizeToolResponseContent(content);
    }

    return response;
  }

  private normalizeToolResponseContent(content: unknown): unknown {
    if (typeof content !== 'string') {
      return content;
    }

    try {
      const parsed = JSON.parse(content) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
      return content;
    } catch {
      return content;
    }
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
