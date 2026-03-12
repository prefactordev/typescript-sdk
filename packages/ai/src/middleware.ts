/**
 * @fileoverview Prefactor middleware implementation for Vercel AI SDK.
 *
 * This module provides a middleware that wraps AI SDK model calls
 * to capture telemetry data and send it to the Prefactor platform.
 *
 * @module middleware
 * @packageDocumentation
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type AgentInstanceManager,
  type Span,
  SpanContext,
  SpanType,
  type TokenUsage,
  type Tracer,
} from '@prefactor/core';
import { resolveToolSpanType } from './schema.js';
import { createToolSpanInputs, createToolSpanOutputs } from './tool-span-contract.js';
import type { LanguageModelMiddleware, MiddlewareConfig } from './types.js';

const AGENT_DEAD_TIMEOUT_MS = 5 * 60 * 1000;
const WRAPPED_TOOL_EXECUTE = Symbol('prefactor-ai-wrapped-tool-execute');
const TOOL_CAPTURE_STATE_STORAGE = new AsyncLocalStorage<ToolCaptureState>();

type PromptToolResult = {
  toolName: string;
  toolCallId?: string;
  input?: unknown;
  output: unknown;
};

type ToolCaptureState = {
  executedToolNames: Set<string>;
  executedToolCallIds: Set<string>;
};

type ToolExecute = (this: unknown, ...args: unknown[]) => unknown;
type WrappedToolExecute = ToolExecute & { [WRAPPED_TOOL_EXECUTE]?: true };
type ToolDefinition = {
  description?: string;
  execute?: ToolExecute;
  name?: string;
};
type PromptMessage = {
  content?: unknown;
  role?: unknown;
};
type PromptPart = {
  args?: unknown;
  input?: unknown;
  output?: unknown;
  text?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  type?: unknown;
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

function createToolCaptureState(): ToolCaptureState {
  return {
    executedToolNames: new Set<string>(),
    executedToolCallIds: new Set<string>(),
  };
}

function wrapToolExecute(
  tracer: Tracer,
  toolName: string,
  toolSpanTypes: Record<string, string> | undefined,
  execute: ToolExecute
): WrappedToolExecute {
  const existingExecute = execute as WrappedToolExecute;
  if (existingExecute[WRAPPED_TOOL_EXECUTE]) {
    return existingExecute;
  }

  const wrapped: WrappedToolExecute = async function wrappedExecute(
    this: unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    const input = args[0] ?? {};
    const toolCallId = extractToolCallId(args);
    const span = tracer.startSpan({
      name: 'ai:tool-call',
      spanType: resolveToolSpanType(toolName, toolSpanTypes),
      inputs: createToolSpanInputs({
        toolName,
        toolCallId,
        input,
      }),
    });

    try {
      const output = await SpanContext.runAsync(span, () =>
        Promise.resolve(execute.apply(this, args))
      );
      const captureState = TOOL_CAPTURE_STATE_STORAGE.getStore();
      captureState?.executedToolNames.add(toolName);
      if (toolCallId) {
        captureState?.executedToolCallIds.add(toolCallId);
      }
      tracer.endSpan(span, { outputs: createToolSpanOutputs(output) });
      return output;
    } catch (error) {
      const normalizedError = toError(error);
      tracer.endSpan(span, {
        outputs: createToolSpanOutputs(undefined),
        error: normalizedError,
      });
      throw error;
    }
  };

  wrapped[WRAPPED_TOOL_EXECUTE] = true;
  return wrapped;
}

function wrapToolsInParams<T extends Record<string, unknown> & { tools?: unknown }>(
  params: T,
  tracer: Tracer,
  toolSpanTypes?: Record<string, string>
): T {
  if (!('tools' in params)) {
    return params;
  }

  if (Array.isArray(params.tools)) {
    params.tools = wrapToolArray(params.tools, tracer, toolSpanTypes);
    return params;
  }

  if (isRecord(params.tools)) {
    params.tools = wrapToolMap(params.tools, tracer, toolSpanTypes);
  }

  return params;
}

function wrapToolArray(
  tools: unknown[],
  tracer: Tracer,
  toolSpanTypes?: Record<string, string>
): unknown[] {
  return tools.map((tool, index) => {
    const typedTool = getToolDefinition(tool);
    if (!typedTool?.execute) {
      return tool;
    }

    const toolName = typedTool.name ?? `tool_${index}`;
    return {
      ...typedTool,
      execute: wrapToolExecute(tracer, toolName, toolSpanTypes, typedTool.execute),
    };
  });
}

function wrapToolMap(
  tools: Record<string, unknown>,
  tracer: Tracer,
  toolSpanTypes?: Record<string, string>
): Record<string, unknown> {
  for (const [toolName, tool] of Object.entries(tools)) {
    const typedTool = getToolDefinition(tool);
    if (!typedTool?.execute) {
      continue;
    }

    tools[toolName] = {
      ...typedTool,
      execute: wrapToolExecute(tracer, toolName, toolSpanTypes, typedTool.execute),
    };
  }

  return tools;
}

function getToolDefinition(tool: unknown): ToolDefinition | undefined {
  if (!isRecord(tool)) {
    return undefined;
  }

  return {
    description: typeof tool.description === 'string' ? tool.description : undefined,
    execute: typeof tool.execute === 'function' ? (tool.execute as ToolExecute) : undefined,
    name: typeof tool.name === 'string' ? tool.name : undefined,
  };
}

function extractToolCallId(args: unknown[]): string | undefined {
  for (const arg of args.slice(0, 2)) {
    if (!arg || typeof arg !== 'object') {
      continue;
    }

    const candidate = arg as {
      toolCallId?: unknown;
      options?: { toolCallId?: unknown };
    };
    if (typeof candidate.toolCallId === 'string') {
      return candidate.toolCallId;
    }
    if (typeof candidate.options?.toolCallId === 'string') {
      return candidate.options.toolCallId;
    }
  }

  return undefined;
}

function extractPromptToolResults(params: Record<string, unknown>): PromptToolResult[] {
  const prompt = Array.isArray(params.prompt) ? (params.prompt as PromptMessage[]) : [];
  const toolCallInputs = new Map<string, unknown>();
  const results: PromptToolResult[] = [];

  for (const message of prompt) {
    const content = Array.isArray(message.content) ? (message.content as PromptPart[]) : [];

    if (message.role === 'assistant') {
      collectAssistantToolInputs(content, toolCallInputs);
      continue;
    }

    if (message.role !== 'tool') {
      continue;
    }

    appendPromptToolResults(content, toolCallInputs, results);
  }

  return results;
}

function collectAssistantToolInputs(
  content: PromptPart[],
  toolCallInputs: Map<string, unknown>
): void {
  for (const part of content) {
    if (!isToolCallPart(part) || typeof part.toolCallId !== 'string') {
      continue;
    }

    toolCallInputs.set(part.toolCallId, part.input ?? part.args);
  }
}

function appendPromptToolResults(
  content: PromptPart[],
  toolCallInputs: Map<string, unknown>,
  results: PromptToolResult[]
): void {
  for (const part of content) {
    if (!isToolResultPart(part)) {
      continue;
    }

    const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
    results.push({
      toolName: typeof part.toolName === 'string' ? part.toolName : 'unknown',
      toolCallId,
      input: toolCallId ? toolCallInputs.get(toolCallId) : undefined,
      output: part.output,
    });
  }
}

function emitToolResultSpansFromPrompt(
  tracer: Tracer,
  span: Span,
  toolResults: PromptToolResult[],
  seenToolCallIds: Set<string>,
  captureState: ToolCaptureState,
  toolSpanTypes?: Record<string, string>
): void {
  if (toolResults.length === 0) {
    return;
  }

  SpanContext.run(span, () => {
    for (const toolResult of toolResults) {
      if (toolResult.toolCallId) {
        if (captureState.executedToolCallIds.has(toolResult.toolCallId)) {
          continue;
        }
      } else if (captureState.executedToolNames.has(toolResult.toolName)) {
        continue;
      }

      if (toolResult.toolCallId) {
        if (seenToolCallIds.has(toolResult.toolCallId)) {
          continue;
        }
        seenToolCallIds.add(toolResult.toolCallId);
      }

      const toolSpan = tracer.startSpan({
        name: 'ai:tool-call',
        spanType: resolveToolSpanType(toolResult.toolName, toolSpanTypes),
        inputs: createToolSpanInputs({
          toolName: toolResult.toolName,
          toolCallId: toolResult.toolCallId,
          input: toolResult.input,
        }),
      });

      tracer.endSpan(toolSpan, {
        outputs: createToolSpanOutputs(toolResult.output),
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
  params: Record<string, unknown>,
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

  const serializedTools =
    config?.captureTools === false ? undefined : serializeToolsForInputs(params.tools);
  if (serializedTools !== undefined) {
    inputs['ai.tools'] = serializedTools;
  }

  return inputs;
}

function serializeToolsForInputs(tools: unknown): unknown {
  if (tools === undefined) {
    return undefined;
  }

  if (Array.isArray(tools)) {
    return tools.map((tool) => {
      const typedTool = getToolDefinition(tool);
      return typedTool
        ? {
            name: typedTool.name,
            description: typedTool.description,
          }
        : tool;
    });
  }

  if (isRecord(tools)) {
    return Object.entries(tools).map(([name, tool]) => {
      const typedTool = getToolDefinition(tool);
      return {
        name,
        description: typedTool?.description,
      };
    });
  }

  return tools;
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
  result: Record<string, unknown>,
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
    if (content) {
      outputs['ai.response.content'] = content;
    }

    const responseText = extractResponseText(result, content);
    if (responseText !== undefined) {
      outputs['ai.response.text'] = responseText;
    }
  }

  const toolCalls =
    config?.captureTools === false ? undefined : extractResponseToolCalls(result, content);
  if (toolCalls !== undefined) {
    outputs['ai.response.toolCalls'] = toolCalls;
  }

  return outputs;
}

function extractResponseText(
  result: Record<string, unknown>,
  content: unknown[] | undefined
): string | undefined {
  const contentText = content ? extractContentText(content) : undefined;
  if (contentText !== undefined) {
    return contentText;
  }

  return typeof result.text === 'string' ? result.text : undefined;
}

function extractContentText(content: unknown[]): string | undefined {
  const textParts = content.filter(isTextContentPart).map((part) => part.text);
  return textParts.length > 0 ? textParts.join('') : undefined;
}

function extractResponseToolCalls(
  result: Record<string, unknown>,
  content: unknown[] | undefined
): unknown {
  if (result.toolCalls !== undefined) {
    return result.toolCalls;
  }

  if (!content) {
    return undefined;
  }

  const toolCalls = content.filter(isToolCallPart);
  return toolCalls.length > 0 ? toolCalls : undefined;
}

/**
 * Extracts token usage from generation result.
 *
 * @param result - The generation result from AI SDK
 * @returns TokenUsage object or undefined
 * @internal
 */
function extractTokenUsage(result: Record<string, unknown>): TokenUsage | undefined {
  if (!isRecord(result.usage)) {
    return undefined;
  }

  return extractStructuredTokenUsage(result.usage) ?? extractLegacyTokenUsage(result.usage);
}

function extractStructuredTokenUsage(usage: Record<string, unknown>): TokenUsage | undefined {
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
    return undefined;
  }

  const promptTokens = getNestedTokenTotal(usage.inputTokens);
  const completionTokens = getNestedTokenTotal(usage.outputTokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function extractLegacyTokenUsage(usage: Record<string, unknown>): TokenUsage | undefined {
  if (usage.promptTokens === undefined && usage.completionTokens === undefined) {
    return undefined;
  }

  const promptTokens = typeof usage.promptTokens === 'number' ? usage.promptTokens : 0;
  const completionTokens = typeof usage.completionTokens === 'number' ? usage.completionTokens : 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function getNestedTokenTotal(value: unknown): number {
  return isRecord(value) && typeof value.total === 'number' ? value.total : 0;
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
  model: Record<string, unknown>,
  params: Record<string, unknown>,
  config?: MiddlewareConfig,
  parentSpan?: Span
): Span {
  const modelName = `${model.provider ?? 'unknown'}.${model.modelId ?? 'unknown'}`;
  const spanOptions = {
    name: 'ai:llm-call',
    spanType: `ai-sdk:${SpanType.LLM}`,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolCallPart(part: unknown): part is PromptPart {
  return isRecord(part) && (part.type === 'tool-call' || part.type === 'tool');
}

function isToolResultPart(part: unknown): part is PromptPart {
  return isRecord(part) && part.type === 'tool-result';
}

function isTextContentPart(part: unknown): part is PromptPart & { text: string } {
  return isRecord(part) && part.type === 'text' && typeof part.text === 'string';
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
    toolSpanTypes?: Record<string, string>;
  }
): LanguageModelMiddleware {
  const agentManager = coreOptions?.agentManager;
  const agentInfo = coreOptions?.agentInfo;
  const agentLifecycle = coreOptions?.agentLifecycle ?? { started: false };
  const deadTimeoutMs = coreOptions?.deadTimeoutMs ?? AGENT_DEAD_TIMEOUT_MS;
  const toolSpanTypes = coreOptions?.toolSpanTypes;

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
      config?.captureTools === false ? params : wrapToolsInParams(params, tracer, toolSpanTypes),
    /**
     * Wraps non-streaming generation calls.
     */
    wrapGenerate: async ({ doGenerate, params, model }) => {
      ensureAgentInstanceStarted();

      // Use existing context when available; otherwise the LLM span becomes root
      const parentSpan = SpanContext.getCurrent();
      const span = createLlmSpan(tracer, model, params, config, parentSpan);
      const seenToolCallIds = new Set<string>();
      const captureState = createToolCaptureState();

      try {
        // Execute the generation within the LLM span context
        const result = await runWithTimeout(
          () =>
            TOOL_CAPTURE_STATE_STORAGE.run(captureState, () =>
              SpanContext.runAsync(span, () => Promise.resolve(doGenerate()))
            ),
          deadTimeoutMs,
          'Agent did not respond within timeout duration and was marked as failed.'
        );

        if (config?.captureTools !== false) {
          emitToolResultSpansFromPrompt(
            tracer,
            span,
            extractPromptToolResults(params),
            seenToolCallIds,
            captureState,
            toolSpanTypes
          );
        }

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
      const captureState = createToolCaptureState();

      try {
        // Execute the stream within the span context
        const result = await runWithTimeout(
          () =>
            TOOL_CAPTURE_STATE_STORAGE.run(captureState, () =>
              SpanContext.runAsync(span, () => Promise.resolve(doStream()))
            ),
          deadTimeoutMs,
          'Agent did not respond within timeout duration and was marked as failed.'
        );

        if (config?.captureTools !== false) {
          emitToolResultSpansFromPrompt(
            tracer,
            span,
            extractPromptToolResults(params),
            seenToolCallIds,
            captureState,
            toolSpanTypes
          );
        }

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
function wrapStreamForCompletion<T>(
  stream: ReadableStream<T>,
  span: Span,
  tracer: Tracer,
  config?: MiddlewareConfig
): ReadableStream<T> {
  const reader = stream.getReader();
  let finishReason: unknown | undefined;
  let usage: TokenUsage | undefined;
  const textChunks: string[] = [];

  return new ReadableStream<T>({
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
        const part = getStreamPart(value);
        if (part) {
          const delta = extractTextDelta(part);
          if (delta !== undefined) {
            textChunks.push(delta);
          }

          if (part.type === 'finish') {
            finishReason = part.finishReason ?? finishReason;
            usage = part.usage ? extractTokenUsage({ usage: part.usage }) : usage;
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

function getStreamPart(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function extractTextDelta(part: Record<string, unknown>): string | undefined {
  if (part.type !== 'text-delta') {
    return undefined;
  }

  if (typeof part.delta === 'string') {
    return part.delta;
  }

  return typeof part.textDelta === 'string' ? part.textDelta : undefined;
}
