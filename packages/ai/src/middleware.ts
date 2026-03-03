/**
 * @fileoverview Prefactor middleware implementation for Vercel AI SDK.
 *
 * This module provides a middleware that wraps AI SDK model calls
 * to capture telemetry data and send it to the Prefactor platform.
 *
 * @module middleware
 * @packageDocumentation
 */

import {
  type AgentInstanceManager,
  createSpanTypePrefixer,
  type Span,
  SpanContext,
  SpanType,
  type TokenUsage,
  type Tracer,
} from '@prefactor/core';
import type { LanguageModelMiddleware, MiddlewareConfig } from './types.js';

const AGENT_DEAD_TIMEOUT_MS = 5 * 60 * 1000;
const toAiSpanType = createSpanTypePrefixer('ai-sdk');
const WRAPPED_TOOL_EXECUTE = Symbol('prefactor-ai-wrapped-tool-execute');

type PromptToolResult = {
  toolName: string;
  toolCallId?: string;
  input?: unknown;
  output: unknown;
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function runWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    operation()
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function markAgentDead(
  agentManager: AgentInstanceManager | undefined,
  agentLifecycle: { started: boolean }
): void {
  if (!agentManager || !agentLifecycle.started) {
    return;
  }

  agentManager.finishInstance();
  agentLifecycle.started = false;
}

function wrapToolExecute(
  tracer: Tracer,
  toolName: string,
  // biome-ignore lint/suspicious/noExplicitAny: Tool execute signatures vary by provider/version
  execute: (...args: any[]) => unknown
  // biome-ignore lint/suspicious/noExplicitAny: Tool execute signatures vary by provider/version
): (...args: any[]) => Promise<unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: Symbol metadata on function object
  if ((execute as any)[WRAPPED_TOOL_EXECUTE]) {
    return execute as (...args: unknown[]) => Promise<unknown>;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Tool execute signatures vary by provider/version
  const wrapped = async function wrappedExecute(this: unknown, ...args: any[]): Promise<unknown> {
    const input = args[0] ?? {};
    const span = tracer.startSpan({
      name: 'ai:tool-call',
      spanType: toAiSpanType(SpanType.TOOL),
      inputs: {
        'ai.tool.name': toolName,
        toolName,
        input,
      },
    });

    try {
      const output = await SpanContext.runAsync(span, () =>
        Promise.resolve(execute.apply(this, args))
      );
      tracer.endSpan(span, { outputs: { output } });
      return output;
    } catch (error) {
      const normalizedError = toError(error);
      tracer.endSpan(span, { error: normalizedError });
      throw error;
    }
  };

  // biome-ignore lint/suspicious/noExplicitAny: Symbol metadata on function object
  (wrapped as any)[WRAPPED_TOOL_EXECUTE] = true;
  return wrapped;
}

// biome-ignore lint/suspicious/noExplicitAny: AI SDK call options are dynamic
function wrapToolsInParams(params: any, tracer: Tracer): any {
  if (!params?.tools || typeof params.tools !== 'object') {
    return params;
  }

  if (Array.isArray(params.tools)) {
    params.tools = params.tools.map((tool: unknown, index: number) => {
      if (!tool || typeof tool !== 'object') {
        return tool;
      }

      const typedTool = tool as {
        name?: string;
        execute?: (...args: unknown[]) => unknown;
      };

      if (typeof typedTool.execute !== 'function') {
        return tool;
      }

      const toolName = typedTool.name ?? `tool_${index}`;
      return {
        ...typedTool,
        execute: wrapToolExecute(tracer, toolName, typedTool.execute),
      };
    });
    return params;
  }

  const tools = params.tools as Record<string, unknown>;
  for (const [toolName, tool] of Object.entries(tools)) {
    if (!tool || typeof tool !== 'object') {
      continue;
    }

    const typedTool = tool as {
      execute?: (...args: unknown[]) => unknown;
    };

    if (typeof typedTool.execute !== 'function') {
      continue;
    }

    tools[toolName] = {
      ...typedTool,
      execute: wrapToolExecute(tracer, toolName, typedTool.execute),
    };
  }

  return params;
}

// biome-ignore lint/suspicious/noExplicitAny: AI SDK call options are dynamic
function hasExecutableToolsInParams(params: any): boolean {
  if (Array.isArray(params?.tools)) {
    return params.tools.some(
      (tool: unknown) =>
        typeof tool === 'object' &&
        tool !== null &&
        typeof (tool as { execute?: unknown }).execute === 'function'
    );
  }

  if (params?.tools && typeof params.tools === 'object') {
    return Object.values(params.tools as Record<string, unknown>).some(
      (tool: unknown) =>
        typeof tool === 'object' &&
        tool !== null &&
        typeof (tool as { execute?: unknown }).execute === 'function'
    );
  }

  return false;
}

function normalizeToolResultOutput(output: unknown): unknown {
  if (
    typeof output === 'object' &&
    output !== null &&
    (output as { type?: unknown }).type === 'text' &&
    typeof (output as { value?: unknown }).value === 'string'
  ) {
    return (output as { value: string }).value;
  }

  return output;
}

// biome-ignore lint/suspicious/noExplicitAny: AI SDK prompt/message structures are dynamic
function extractPromptToolResults(params: any): PromptToolResult[] {
  const prompt = Array.isArray(params?.prompt) ? params.prompt : [];
  const toolCallInputs = new Map<string, unknown>();
  const results: PromptToolResult[] = [];

  for (const message of prompt) {
    const content = Array.isArray(message?.content) ? message.content : [];

    if (message?.role === 'assistant') {
      for (const part of content) {
        if (
          (part?.type === 'tool-call' || part?.type === 'tool') &&
          typeof part?.toolCallId === 'string'
        ) {
          toolCallInputs.set(part.toolCallId, part.input ?? part.args);
        }
      }
      continue;
    }

    if (message?.role !== 'tool') {
      continue;
    }

    for (const part of content) {
      if (part?.type !== 'tool-result') {
        continue;
      }

      const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
      results.push({
        toolName: part.toolName ?? 'unknown',
        toolCallId,
        input: toolCallId ? toolCallInputs.get(toolCallId) : undefined,
        output: part.output,
      });
    }
  }

  return results;
}

function emitToolResultSpansFromPrompt(
  tracer: Tracer,
  span: Span,
  toolResults: PromptToolResult[],
  seenToolCallIds: Set<string>
): void {
  if (toolResults.length === 0) {
    return;
  }

  SpanContext.run(span, () => {
    for (const toolResult of toolResults) {
      if (toolResult.toolCallId) {
        if (seenToolCallIds.has(toolResult.toolCallId)) {
          continue;
        }
        seenToolCallIds.add(toolResult.toolCallId);
      }

      const toolSpan = tracer.startSpan({
        name: 'ai:tool-call',
        spanType: toAiSpanType(SpanType.TOOL),
        inputs: {
          'ai.tool.name': toolResult.toolName,
          toolName: toolResult.toolName,
          ...(toolResult.toolCallId ? { toolCallId: toolResult.toolCallId } : {}),
          ...(toolResult.input !== undefined ? { input: toolResult.input } : {}),
        },
      });

      tracer.endSpan(toolSpan, {
        outputs: { output: normalizeToolResultOutput(toolResult.output) },
      });
    }
  });
}

/** Model settings to capture from params */
const MODEL_SETTINGS = [
  'maxOutputTokens',
  'maxTokens',
  'temperature',
  'topP',
  'topK',
  'frequencyPenalty',
  'presencePenalty',
  'stopSequences',
  'seed',
  'toolChoice',
  'responseFormat',
] as const;

/**
 * Extracts input data from call parameters.
 *
 * @param params - The call parameters from AI SDK
 * @param config - Middleware configuration
 * @returns Record of input data for the span
 * @internal
 */
function extractInputs(
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK params are dynamic
  params: any,
  config?: MiddlewareConfig
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  // Capture model settings
  for (const setting of MODEL_SETTINGS) {
    if (params[setting] !== undefined) {
      inputs[`ai.settings.${setting}`] = params[setting];
    }
  }

  // Capture prompt content if enabled
  if (config?.captureContent !== false && params.prompt) {
    inputs['ai.prompt'] = params.prompt;
  }

  // Capture tools if enabled
  if (config?.captureTools !== false && params.tools) {
    // AI SDK v4 uses an object map; normalize to names to avoid serializing tool functions.
    if (Array.isArray(params.tools)) {
      inputs['ai.tools'] = params.tools.map((tool: { name?: string; description?: string }) => ({
        name: tool.name,
        description: tool.description,
      }));
    } else if (typeof params.tools === 'object') {
      inputs['ai.tools'] = Object.entries(
        params.tools as Record<string, { description?: string } | undefined>
      ).map(([name, tool]) => ({
        name,
        description: typeof tool?.description === 'string' ? tool.description : undefined,
      }));
    } else {
      inputs['ai.tools'] = params.tools;
    }
  }

  return inputs;
}

/**
 * Extracts output data from generation result.
 *
 * @param result - The generation result from AI SDK
 * @param config - Middleware configuration
 * @returns Record of output data for the span
 * @internal
 */
function extractOutputs(
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK result structure is dynamic
  result: any,
  config?: MiddlewareConfig
): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};

  // Capture finish reason
  if (result.finishReason) {
    outputs['ai.finishReason'] = result.finishReason;
  }

  const content = Array.isArray(result.content) ? result.content : undefined;

  // Capture response content if enabled
  if (config?.captureContent !== false) {
    if (result.text) {
      outputs['ai.response.text'] = result.text;
    }
    if (content) {
      outputs['ai.response.content'] = content;
      const textParts = content
        .filter(
          (part: { type: string; text: string }) =>
            part?.type === 'text' && typeof part.text === 'string'
        )
        .map((part: { text: string }) => part.text);
      if (textParts.length > 0) {
        outputs['ai.response.text'] = textParts.join('');
      }
    }
  }

  // Capture tool calls if enabled
  if (config?.captureTools !== false) {
    if (result.toolCalls) {
      outputs['ai.response.toolCalls'] = result.toolCalls;
    } else if (content) {
      const toolCalls = content.filter((part: { type: string }) => part?.type === 'tool-call');
      if (toolCalls.length > 0) {
        outputs['ai.response.toolCalls'] = toolCalls;
      }
    }
  }

  return outputs;
}

/**
 * Extracts token usage from generation result.
 *
 * @param result - The generation result from AI SDK
 * @returns TokenUsage object or undefined
 * @internal
 */
function extractTokenUsage(
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK result structure varies by provider
  result: any
): TokenUsage | undefined {
  if (!result.usage) {
    return undefined;
  }

  const usage = result.usage;

  // Handle V3 usage format (inputTokens/outputTokens objects)
  if (usage.inputTokens || usage.outputTokens) {
    const promptTokens = usage.inputTokens?.total ?? 0;
    const completionTokens = usage.outputTokens?.total ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  // Handle V1 usage format (promptTokens/completionTokens)
  if (usage.promptTokens !== undefined || usage.completionTokens !== undefined) {
    const promptTokens = usage.promptTokens ?? 0;
    const completionTokens = usage.completionTokens ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  return undefined;
}

/**
 * Creates an LLM span, optionally within a parent span context.
 *
 * @param tracer - The tracer instance
 * @param model - Model information (provider, modelId)
 * @param params - Call parameters
 * @param config - Middleware configuration
 * @param parentSpan - Optional parent span
 * @returns The created span
 * @internal
 */
function createLlmSpan(
  tracer: Tracer,
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK model structure is dynamic
  model: any,
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK params are dynamic
  params: any,
  config?: MiddlewareConfig,
  parentSpan?: Span
): Span {
  const modelName = `${model.provider ?? 'unknown'}.${model.modelId ?? 'unknown'}`;
  const spanOptions = {
    name: 'ai:llm-call',
    spanType: toAiSpanType(SpanType.LLM),
    inputs: {
      'ai.model.name': modelName,
      'ai.model.id': model.modelId,
      'ai.model.provider': model.provider,
      ...extractInputs(params, config),
    },
  };

  if (parentSpan) {
    return SpanContext.run(parentSpan, () => tracer.startSpan(spanOptions));
  }
  return tracer.startSpan(spanOptions);
}

/**
 * Creates a Prefactor middleware for the Vercel AI SDK.
 *
 * This middleware wraps model calls to capture telemetry data including:
 * - Request parameters (prompt, settings, tools)
 * - Response data (content, finish reason, tool calls)
 * - Token usage statistics
 * - Timing information
 * - Error tracking
 *
 * @param tracer - The Prefactor tracer instance
 * @param config - Optional middleware configuration
 * @returns A middleware object compatible with wrapLanguageModel
 *
 * @example
 * ```typescript
 * import { wrapLanguageModel } from 'ai';
 * import { createPrefactorMiddleware } from '@prefactor/ai';
 *
 * const middleware = createPrefactorMiddleware(tracer);
 * const model = wrapLanguageModel({
 *   model: anthropic('claude-3-haiku-20240307'),
 *   middleware,
 * });
 * ```
 */
export function createPrefactorMiddleware(
  tracer: Tracer,
  config?: MiddlewareConfig,
  coreOptions?: {
    agentManager: AgentInstanceManager;
    agentInfo?: Parameters<AgentInstanceManager['startInstance']>[0];
    agentLifecycle?: { started: boolean };
    deadTimeoutMs?: number;
  }
): LanguageModelMiddleware {
  const agentManager = coreOptions?.agentManager;
  const agentInfo = coreOptions?.agentInfo;
  const agentLifecycle = coreOptions?.agentLifecycle ?? { started: false };
  const deadTimeoutMs = coreOptions?.deadTimeoutMs ?? AGENT_DEAD_TIMEOUT_MS;

  function ensureAgentInstanceStarted(): void {
    if (!agentManager || agentLifecycle.started) {
      return;
    }
    agentManager.startInstance(agentInfo);
    agentLifecycle.started = true;
  }

  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) =>
      config?.captureTools === false ? params : wrapToolsInParams(params, tracer),
    /**
     * Wraps non-streaming generation calls.
     */
    wrapGenerate: async ({ doGenerate, params, model }) => {
      ensureAgentInstanceStarted();

      // Use existing context when available; otherwise the LLM span becomes root
      const parentSpan = SpanContext.getCurrent();
      const span = createLlmSpan(tracer, model, params, config, parentSpan);
      const seenToolCallIds = new Set<string>();

      if (config?.captureTools !== false && !hasExecutableToolsInParams(params)) {
        emitToolResultSpansFromPrompt(
          tracer,
          span,
          extractPromptToolResults(params),
          seenToolCallIds
        );
      }

      try {
        // Execute the generation within the LLM span context
        const result = await runWithTimeout(
          () => SpanContext.runAsync(span, () => Promise.resolve(doGenerate())),
          deadTimeoutMs,
          'Agent did not respond within timeout duration and was marked as failed.'
        );

        // End the span with outputs
        tracer.endSpan(span, {
          outputs: extractOutputs(result, config),
          tokenUsage: extractTokenUsage(result),
        });

        return result;
      } catch (error) {
        // End the span with error
        const normalizedError = toError(error);
        tracer.endSpan(span, { error: normalizedError });
        markAgentDead(agentManager, agentLifecycle);
        throw error;
      }
    },

    /**
     * Wraps streaming generation calls.
     */
    wrapStream: async ({ doStream, params, model }) => {
      ensureAgentInstanceStarted();

      // Use existing context when available; otherwise the LLM span becomes root
      const parentSpan = SpanContext.getCurrent();
      const span = createLlmSpan(tracer, model, params, config, parentSpan);
      const seenToolCallIds = new Set<string>();

      if (config?.captureTools !== false && !hasExecutableToolsInParams(params)) {
        emitToolResultSpansFromPrompt(
          tracer,
          span,
          extractPromptToolResults(params),
          seenToolCallIds
        );
      }

      try {
        // Execute the stream within the span context
        const result = await runWithTimeout(
          () => SpanContext.runAsync(span, () => Promise.resolve(doStream())),
          deadTimeoutMs,
          'Agent did not respond within timeout duration and was marked as failed.'
        );

        // Wrap the stream to capture completion
        const wrappedStream = wrapStreamForCompletion(result.stream, span, tracer, config);

        return {
          ...result,
          stream: wrappedStream,
        };
      } catch (error) {
        // End the span with error
        const normalizedError = toError(error);
        tracer.endSpan(span, { error: normalizedError });
        markAgentDead(agentManager, agentLifecycle);
        throw error;
      }
    },
  };
}

/**
 * Wraps a readable stream to capture completion data and end the span.
 *
 * @param stream - The original stream
 * @param span - The span to end when stream completes
 * @param tracer - The tracer instance
 * @param config - Middleware configuration
 * @returns A wrapped stream that ends the span on completion
 * @internal
 */
function wrapStreamForCompletion(
  // biome-ignore lint/suspicious/noExplicitAny: Stream part types vary
  stream: ReadableStream<any>,
  span: Span,
  tracer: Tracer,
  config?: MiddlewareConfig
  // biome-ignore lint/suspicious/noExplicitAny: Stream part types vary
): ReadableStream<any> {
  const reader = stream.getReader();
  let finishReason: unknown | undefined;
  let usage: TokenUsage | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: Collecting stream chunks
  const textChunks: any[] = [];

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          // Stream completed - end the span
          const outputs: Record<string, unknown> = {};

          if (finishReason) {
            outputs['ai.finishReason'] = finishReason;
          }

          if (config?.captureContent !== false && textChunks.length > 0) {
            outputs['ai.response.text'] = textChunks.join('');
          }

          tracer.endSpan(span, {
            outputs,
            tokenUsage: usage,
          });

          controller.close();
          return;
        }

        // Capture stream parts for telemetry
        const part = value;
        if (part) {
          // Capture text chunks
          if (part.type === 'text-delta') {
            const delta = part.delta ?? part.textDelta;
            if (delta) {
              textChunks.push(delta);
            }
          }

          // Capture finish reason
          if (part.type === 'finish' && part.finishReason) {
            finishReason = part.finishReason;
          }

          // Capture usage from finish part
          if (part.type === 'finish' && part.usage) {
            usage = extractTokenUsage({ usage: part.usage });
          }
        }

        controller.enqueue(value);
      } catch (error) {
        // End the span with error
        tracer.endSpan(span, { error: toError(error) });
        controller.error(error);
      }
    },

    cancel() {
      // Stream was cancelled - end the span
      tracer.endSpan(span, {
        outputs: { 'ai.finishReason': 'cancelled' },
      });
      reader.cancel();
    },
  });
}
