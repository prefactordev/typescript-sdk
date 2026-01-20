import type { Tracer } from '../../tracing/tracer.js';
import { SpanContext } from '../../tracing/context.js';
import { SpanType } from '../../tracing/span.js';
import type { Span } from '../../tracing/span.js';
import { extractTokenUsage } from './metadata-extractor.js';

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
 * import { init } from '@prefactor/sdk';
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
  private rootSpan: Span | null = null;

  constructor(private tracer: Tracer) {}

  /**
   * Called before agent execution starts
   *
   * @param state - Agent state containing messages
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain state can be any structure
  async beforeAgent(state: any): Promise<void> {
    const parentSpan = SpanContext.getCurrent();
    const messages = state?.messages ?? [];

    this.tracer.startAgentInstance();

    const span = this.tracer.startSpan({
      name: 'agent',
      spanType: SpanType.AGENT,
      inputs: { messages: messages.slice(-3).map((m: unknown) => String(m)) },
      parentSpanId: parentSpan?.spanId,
      traceId: parentSpan?.traceId,
    });

    this.rootSpan = span;
  }

  /**
   * Called after agent execution completes
   *
   * @param state - Agent state containing messages
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain state can be any structure
  async afterAgent(state: any): Promise<void> {
    if (!this.rootSpan) {
      return;
    }

    const messages = state?.messages ?? [];
    this.tracer.endSpan(this.rootSpan, {
      outputs: { messages: messages.slice(-3).map((m: unknown) => String(m)) },
    });

    this.tracer.finishAgentInstance();
    SpanContext.clear();
    this.rootSpan = null;
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
    const parentSpan = SpanContext.getCurrent();

    const span = this.tracer.startSpan({
      name: this.extractModelName(request),
      spanType: SpanType.LLM,
      inputs: this.extractModelInputs(request),
      parentSpanId: parentSpan?.spanId,
      traceId: parentSpan?.traceId,
    });

    try {
      // CRITICAL: Wrap handler in context so child operations see this span
      const response = await SpanContext.runAsync(span, async () => {
        return handler(request);
      });

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
    const parentSpan = SpanContext.getCurrent();

    const span = this.tracer.startSpan({
      name: this.extractToolName(request),
      spanType: SpanType.TOOL,
      inputs: this.extractToolInputs(request),
      parentSpanId: parentSpan?.spanId,
      traceId: parentSpan?.traceId,
    });

    try {
      // CRITICAL: Wrap handler in context so child operations see this span
      const response = await SpanContext.runAsync(span, async () => {
        return handler(request);
      });

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
    return request?.model ?? request?.modelName ?? 'unknown';
  }

  /**
   * Extract model inputs from request
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain request structure is dynamic
  private extractModelInputs(request: any): Record<string, unknown> {
    const messages = request?.messages ?? [];
    return { messages: messages.slice(-3).map((m: unknown) => String(m)) };
  }

  /**
   * Extract model outputs from response
   */
  // biome-ignore lint/suspicious/noExplicitAny: LangChain response structure is dynamic
  private extractModelOutputs(response: any): Record<string, unknown> {
    const content = response?.content ?? response?.text ?? '';
    return { content: String(content) };
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
}
