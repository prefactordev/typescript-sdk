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
  getLogger,
  type Span,
  SpanContext,
  SpanType,
  type TokenUsage,
  type Tracer,
} from '@prefactor/core';
import type {
  LanguageModelMiddleware,
  MiddlewareConfig,
  ToolCallInfo,
  WorkflowState,
} from './types.js';

const logger = getLogger('middleware');

/**
 * Workflow manager for tracking multi-step conversations.
 *
 * This manager tracks workflow state across multiple model calls to establish
 * proper parent-child span relationships. It uses timing heuristics and call
 * patterns to detect workflow boundaries.
 *
 * @internal
 */
class WorkflowManager {
  private workflows: Map<string, WorkflowState> = new Map();

  /** Time in milliseconds after which a workflow is considered inactive */
  private readonly WORKFLOW_TIMEOUT = 60000;

  /** Maximum number of calls before considering a conversation a workflow */
  private readonly MIN_WORKFLOW_CALLS = 1;

  /**
   * Get or create a workflow for the current context.
   *
   * @param tracer - The tracer instance
   * @param parentSpanId - Optional parent span ID from existing context
   * @param traceId - Optional trace ID from existing context
   * @param enableWorkflowTracking - Whether workflow tracking is enabled
   * @returns The workflow state, or undefined if workflow tracking is disabled
   */
  getOrCreateWorkflow(
    tracer: Tracer,
    parentSpanId?: string,
    traceId?: string,
    enableWorkflowTracking: boolean = true
  ): WorkflowState | undefined {
    if (!enableWorkflowTracking) {
      return undefined;
    }

    const now = Date.now();

    // If we have a parent span from external context, don't create a workflow
    if (parentSpanId && traceId) {
      return undefined;
    }

    // Look for an active workflow
    let workflow: WorkflowState | undefined;

    for (const [_id, state] of this.workflows.entries()) {
      const inactiveTime = now - state.lastActivityAt;
      if (inactiveTime < this.WORKFLOW_TIMEOUT && state.callCount >= this.MIN_WORKFLOW_CALLS) {
        workflow = state;
        break;
      }
    }

    if (workflow) {
      workflow.lastActivityAt = now;
      workflow.callCount++;
      logger.debug('Using existing workflow', {
        spanId: workflow.agentSpan.spanId,
        callCount: workflow.callCount,
      });
      return workflow;
    }

    // Create a new workflow with an AGENT span
    const agentSpan = tracer.startSpan({
      name: 'agent',
      spanType: SpanType.AGENT,
      inputs: {},
    });

    const newWorkflow: WorkflowState = {
      agentSpan,
      createdAt: now,
      lastActivityAt: now,
      callCount: 1,
    };

    this.workflows.set(agentSpan.spanId, newWorkflow);
    logger.info('Created new workflow with AGENT span', { spanId: agentSpan.spanId });

    return newWorkflow;
  }

  /**
   * End a workflow and complete its AGENT span.
   *
   * @param workflow - The workflow to end
   * @param tracer - The tracer instance
   * @param outputs - Optional outputs for the AGENT span
   */
  endWorkflow(workflow: WorkflowState, tracer: Tracer, outputs?: Record<string, unknown>): void {
    tracer.endSpan(workflow.agentSpan, { outputs });
    this.workflows.delete(workflow.agentSpan.spanId);
    logger.info('Ended workflow', {
      spanId: workflow.agentSpan.spanId,
      totalCalls: workflow.callCount,
    });
  }

  /**
   * Clean up inactive workflows.
   */
  cleanup(tracer: Tracer): void {
    const now = Date.now();
    const toDelete: WorkflowState[] = [];

    for (const state of this.workflows.values()) {
      const inactiveTime = now - state.lastActivityAt;
      if (inactiveTime >= this.WORKFLOW_TIMEOUT) {
        toDelete.push(state);
      }
    }

    for (const workflow of toDelete) {
      tracer.endSpan(workflow.agentSpan, {
        outputs: { status: 'timed_out' },
      });
      this.workflows.delete(workflow.agentSpan.spanId);
    }

    if (toDelete.length > 0) {
      logger.debug('Cleaned up inactive workflows', { count: toDelete.length });
    }
  }

  /**
   * Get all active workflows.
   */
  getActiveWorkflows(): WorkflowState[] {
    return Array.from(this.workflows.values());
  }
}

/** Global workflow manager instance */
let workflowManager: WorkflowManager | undefined;

/**
 * Get or create the global workflow manager.
 */
function getWorkflowManager(tracer: Tracer): WorkflowManager {
  if (!workflowManager) {
    workflowManager = new WorkflowManager();

    // Periodic cleanup of inactive workflows
    setInterval(() => {
      workflowManager?.cleanup(tracer);
    }, 30000);
  }
  return workflowManager;
}

/**
 * Extract tool calls from an AI SDK response.
 *
 * @param result - The generation result from AI SDK
 * @returns Array of tool call information
 * @internal
 */
function extractToolCalls(
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK result structure is dynamic
  result: any
): ToolCallInfo[] {
  const toolCalls: ToolCallInfo[] = [];

  // Extract from result.toolCalls (direct property)
  if (result.toolCalls && Array.isArray(result.toolCalls)) {
    for (const tc of result.toolCalls) {
      toolCalls.push({
        toolName: tc.toolName ?? tc.name ?? 'unknown',
        toolCallId: tc.toolCallId ?? tc.id ?? '',
        input: tc.args ?? tc.input,
        output: tc.output,
      });
    }
  }

  // Extract from result.content (array format)
  if (result.content && Array.isArray(result.content)) {
    for (const part of result.content) {
      if (part?.type === 'tool-call' || part?.type === 'tool') {
        toolCalls.push({
          toolName: part.toolName ?? part.name ?? 'unknown',
          toolCallId: part.toolCallId ?? part.id ?? '',
          input: part.args ?? part.input,
        });
      }
    }
  }

  return toolCalls;
}

/**
 * Extract tool results from an AI SDK response.
 *
 * @param result - The generation result from AI SDK
 * @returns Map of tool call ID to tool output
 * @internal
 */
function extractToolResults(
  // biome-ignore lint/suspicious/noExplicitAny: AI SDK result structure is dynamic
  result: any
): Map<string, unknown> {
  const toolResults = new Map<string, unknown>();

  // Extract from result.content (array format with tool-result)
  if (result.content && Array.isArray(result.content)) {
    for (const part of result.content) {
      if (part?.type === 'tool-result') {
        toolResults.set(part.toolCallId ?? '', part.output);
      }
    }
  }

  return toolResults;
}

/**
 * Create a TOOL span for a tool call.
 *
 * @param tracer - The tracer instance
 * @param toolCall - The tool call information
 * @param parentSpan - The parent span (usually an LLM span)
 * @returns The created span
 * @internal
 */
function createToolSpan(tracer: Tracer, toolCall: ToolCallInfo): Span {
  return tracer.startSpan({
    name: toolCall.toolName,
    spanType: SpanType.TOOL,
    inputs: {
      toolName: toolCall.toolName,
      toolCallId: toolCall.toolCallId,
      input: toolCall.input,
    },
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
    inputs['ai.tools'] = params.tools.map((tool: { name?: string; description?: string }) => ({
      name: tool.name,
      description: tool.description,
    }));
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
  const spanOptions = {
    name: `${model.provider ?? 'unknown'}.${model.modelId ?? 'unknown'}`,
    spanType: SpanType.LLM,
    inputs: {
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
 * import { createPrefactorMiddleware } from '@prefactor/ai-middleware';
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
  }
): LanguageModelMiddleware {
  const enableWorkflowTracking = config?.enableWorkflowTracking !== false;
  const agentManager = coreOptions?.agentManager;
  const agentInfo = coreOptions?.agentInfo;
  const agentLifecycle = coreOptions?.agentLifecycle ?? { started: false };

  function ensureAgentInstanceStarted(): void {
    if (!agentManager || agentLifecycle.started) {
      return;
    }
    agentManager.startInstance(agentInfo);
    agentLifecycle.started = true;
  }

  return {
    specificationVersion: 'v3',
    /**
     * Wraps non-streaming generation calls.
     */
    wrapGenerate: async ({ doGenerate, params, model }) => {
      const parentSpan = SpanContext.getCurrent();

      ensureAgentInstanceStarted();

      // Get or create workflow for this call
      const workflowManager = getWorkflowManager(tracer);
      const workflow = workflowManager.getOrCreateWorkflow(
        tracer,
        parentSpan?.spanId,
        parentSpan?.traceId,
        enableWorkflowTracking
      );

      logger.info('Workflow state', {
        workflowSpanId: workflow?.agentSpan.spanId,
        callCount: workflow?.callCount,
        parentSpanId: workflow?.agentSpan.spanId ?? parentSpan?.spanId,
      });

      // Create LLM span with appropriate parent
      const llmParentSpan = workflow?.agentSpan ?? parentSpan;
      const span = createLlmSpan(tracer, model, params, config, llmParentSpan);

      try {
        // Execute the generation within the LLM span context
        const result = await SpanContext.runAsync(span, async () => doGenerate());

        // Extract and instrument tool calls
        if (config?.captureTools !== false) {
          const toolCalls = extractToolCalls(result);
          const toolResults = extractToolResults(result);

          SpanContext.run(span, () => {
            for (const toolCall of toolCalls) {
              const toolSpan = createToolSpan(tracer, toolCall);

              const output = toolResults.get(toolCall.toolCallId);
              tracer.endSpan(toolSpan, {
                outputs: output !== undefined ? { output } : undefined,
              });
            }
          });
        }

        // End the span with outputs
        tracer.endSpan(span, {
          outputs: extractOutputs(result, config),
          tokenUsage: extractTokenUsage(result),
        });

        return result;
      } catch (error) {
        // End the span with error
        tracer.endSpan(span, { error: error as Error });
        throw error;
      }
    },

    /**
     * Wraps streaming generation calls.
     */
    wrapStream: async ({ doStream, params, model }) => {
      const parentSpan = SpanContext.getCurrent();

      ensureAgentInstanceStarted();

      // Get or create workflow for this call
      const workflowManager = getWorkflowManager(tracer);
      const workflow = workflowManager.getOrCreateWorkflow(
        tracer,
        parentSpan?.spanId,
        parentSpan?.traceId,
        enableWorkflowTracking
      );

      // Create LLM span with appropriate parent
      const llmParentSpan = workflow?.agentSpan ?? parentSpan;
      const span = createLlmSpan(tracer, model, params, config, llmParentSpan);

      try {
        // Execute the stream within the span context
        const result = await SpanContext.runAsync(span, async () => doStream());

        // Wrap the stream to capture completion
        const wrappedStream = wrapStreamForCompletion(
          result.stream,
          span,
          tracer,
          config,
          workflow
        );

        return {
          ...result,
          stream: wrappedStream,
        };
      } catch (error) {
        // End the span with error
        tracer.endSpan(span, { error: error as Error });
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
 * @param workflow - Optional workflow state for tracking
 * @returns A wrapped stream that ends the span on completion
 * @internal
 */
function wrapStreamForCompletion(
  // biome-ignore lint/suspicious/noExplicitAny: Stream part types vary
  stream: ReadableStream<any>,
  span: Span,
  tracer: Tracer,
  config?: MiddlewareConfig,
  _workflow?: WorkflowState
  // biome-ignore lint/suspicious/noExplicitAny: Stream part types vary
): ReadableStream<any> {
  const reader = stream.getReader();
  let finishReason: unknown | undefined;
  let usage: TokenUsage | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: Collecting stream chunks
  const textChunks: any[] = [];
  const toolCalls: ToolCallInfo[] = [];

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

          // Instrument tool calls
          if (config?.captureTools !== false && toolCalls.length > 0) {
            SpanContext.run(span, () => {
              for (const toolCall of toolCalls) {
                const toolSpan = createToolSpan(tracer, toolCall);
                // Tool output is not available in streaming mode
                tracer.endSpan(toolSpan, {});
              }
            });
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

          // Capture tool calls
          if (part.type === 'tool-call' || part.type === 'tool') {
            toolCalls.push({
              toolName: part.toolName ?? part.name ?? 'unknown',
              toolCallId: part.toolCallId ?? part.id ?? '',
              input: part.args ?? part.input,
            });
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
        tracer.endSpan(span, { error: error as Error });
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
