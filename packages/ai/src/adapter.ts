/**
 * @fileoverview Adapter layer bridging OpenTelemetry-compatible API to Prefactor core.
 *
 * This module provides adapter classes that wrap @prefactor/core's Tracer with
 * an OpenTelemetry-compatible interface expected by the Vercel AI SDK.
 *
 * @module adapter
 * @packageDocumentation
 */

import {
  type Span as PrefactorSpan,
  SpanContext,
  SpanType,
  type Tracer as PrefactorTracer,
  type TokenUsage,
} from '@prefactor/core';
import type {
  AiSpan,
  AiSpanContext,
  AiSpanOptions,
  AiSpanStatus,
  AiTracer,
} from './types.js';
import { AiSpanStatusCode } from './types.js';

// ============================================================================
// Span Type Inference
// ============================================================================

/**
 * Infers the Prefactor SpanType from an AI SDK span name.
 *
 * The AI SDK uses naming patterns like:
 * - ai.generateText, ai.generateText.doGenerate
 * - ai.streamText, ai.streamText.doStream
 * - ai.toolCall.calculator
 * - ai.embed, ai.embedMany
 *
 * @param name - The span name from AI SDK
 * @returns The corresponding Prefactor SpanType
 * @internal
 */
function inferSpanType(name: string): SpanType {
  const lowerName = name.toLowerCase();

  // Tool calls
  if (lowerName.includes('toolcall') || lowerName.includes('tool_call')) {
    return SpanType.TOOL;
  }

  // LLM operations
  if (
    lowerName.includes('generatetext') ||
    lowerName.includes('streamtext') ||
    lowerName.includes('generateobject') ||
    lowerName.includes('streamobject') ||
    lowerName.includes('embed') ||
    lowerName.includes('dogenerate') ||
    lowerName.includes('dostream')
  ) {
    return SpanType.LLM;
  }

  // Default to CHAIN for other operations
  return SpanType.CHAIN;
}

// ============================================================================
// Attribute Categorization
// ============================================================================

/** Attributes that map to inputs. */
const INPUT_ATTRIBUTES = new Set([
  'ai.prompt',
  'ai.prompt.messages',
  'ai.model.id',
  'ai.model.provider',
  'ai.operationId',
  'ai.settings.maxTokens',
  'ai.settings.temperature',
  'ai.settings.topP',
  'ai.settings.topK',
  'ai.settings.frequencyPenalty',
  'ai.settings.presencePenalty',
  'ai.settings.stopSequences',
  'ai.settings.mode',
  'gen_ai.request.model',
  'gen_ai.system',
]);

/** Attributes that map to outputs. */
const OUTPUT_ATTRIBUTES = new Set([
  'ai.response.text',
  'ai.response.object',
  'ai.response.toolCalls',
  'ai.finishReason',
  'gen_ai.response.finish_reasons',
]);

/** Attributes that map to token usage. */
const TOKEN_ATTRIBUTES = {
  'ai.usage.promptTokens': 'promptTokens',
  'ai.usage.completionTokens': 'completionTokens',
  'gen_ai.usage.input_tokens': 'promptTokens',
  'gen_ai.usage.output_tokens': 'completionTokens',
} as const;

/**
 * Categorizes accumulated attributes into inputs, outputs, metadata, and token usage.
 *
 * @param attributes - All accumulated attributes
 * @returns Categorized attribute groups
 * @internal
 */
function categorizeAttributes(attributes: Record<string, unknown>): {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
  tokenUsage: TokenUsage | null;
} {
  const inputs: Record<string, unknown> = {};
  const outputs: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  for (const [key, value] of Object.entries(attributes)) {
    // Check for token usage
    if (key in TOKEN_ATTRIBUTES) {
      const tokenKey = TOKEN_ATTRIBUTES[key as keyof typeof TOKEN_ATTRIBUTES];
      if (tokenKey === 'promptTokens') {
        promptTokens = typeof value === 'number' ? value : undefined;
      } else if (tokenKey === 'completionTokens') {
        completionTokens = typeof value === 'number' ? value : undefined;
      }
      continue;
    }

    // Check for input attributes
    if (INPUT_ATTRIBUTES.has(key)) {
      inputs[key] = value;
      continue;
    }

    // Check for output attributes
    if (OUTPUT_ATTRIBUTES.has(key)) {
      outputs[key] = value;
      continue;
    }

    // Everything else goes to metadata
    metadata[key] = value;
  }

  // Build token usage if we have data
  let tokenUsage: TokenUsage | null = null;
  if (promptTokens !== undefined || completionTokens !== undefined) {
    tokenUsage = {
      promptTokens: promptTokens ?? 0,
      completionTokens: completionTokens ?? 0,
      totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0),
    };
  }

  return { inputs, outputs, metadata, tokenUsage };
}

// ============================================================================
// AiSpanAdapter
// ============================================================================

/**
 * Adapter that wraps a Prefactor Span with an OpenTelemetry-compatible interface.
 *
 * This class accumulates attributes during the span's lifetime and maps them
 * to Prefactor's inputs/outputs/metadata when the span ends.
 */
export class AiSpanAdapter implements AiSpan {
  /** Accumulated attributes during span lifetime. */
  private attributes: Record<string, unknown> = {};

  /** Whether the span has been ended. */
  private ended = false;

  /** Recorded error, if any. */
  private error: Error | null = null;

  /** The span's status. */
  private status: AiSpanStatus = { code: AiSpanStatusCode.UNSET };

  /**
   * Creates a new AiSpanAdapter.
   *
   * @param prefactorSpan - The underlying Prefactor span
   * @param prefactorTracer - The Prefactor tracer (for ending the span)
   */
  constructor(
    private prefactorSpan: PrefactorSpan,
    private prefactorTracer: PrefactorTracer
  ) {}

  /**
   * Returns the span context.
   */
  spanContext(): AiSpanContext {
    return {
      traceId: this.prefactorSpan.traceId,
      spanId: this.prefactorSpan.spanId,
      traceFlags: 1, // Always sampled
    };
  }

  /**
   * Sets a single attribute.
   */
  setAttribute(key: string, value: unknown): AiSpan {
    if (!this.ended) {
      this.attributes[key] = value;
    }
    return this;
  }

  /**
   * Sets multiple attributes.
   */
  setAttributes(attributes: Record<string, unknown>): AiSpan {
    if (!this.ended) {
      Object.assign(this.attributes, attributes);
    }
    return this;
  }

  /**
   * Adds a timed event (stored in metadata).
   */
  addEvent(
    name: string,
    attributesOrStartTime?: Record<string, unknown> | number | Date | [number, number],
    startTime?: number | Date | [number, number]
  ): AiSpan {
    if (!this.ended) {
      // Parse overloaded arguments
      let attributes: Record<string, unknown> | undefined;
      let timestamp: number;

      if (attributesOrStartTime === undefined) {
        timestamp = Date.now();
      } else if (
        typeof attributesOrStartTime === 'number' ||
        attributesOrStartTime instanceof Date ||
        Array.isArray(attributesOrStartTime)
      ) {
        // Second param is start time
        timestamp = this.parseTimeInput(attributesOrStartTime);
      } else {
        // Second param is attributes
        attributes = attributesOrStartTime;
        timestamp = startTime ? this.parseTimeInput(startTime) : Date.now();
      }

      // Store events in metadata as an array
      const events = (this.attributes['_events'] as Array<unknown>) ?? [];
      events.push({
        name,
        timestamp,
        attributes,
      });
      this.attributes['_events'] = events;
    }
    return this;
  }

  /**
   * Parses a TimeInput value to a timestamp in milliseconds.
   * @internal
   */
  private parseTimeInput(time: number | Date | [number, number]): number {
    if (typeof time === 'number') {
      return time;
    }
    if (time instanceof Date) {
      return time.getTime();
    }
    // HrTime tuple: [seconds, nanoseconds]
    return time[0] * 1000 + time[1] / 1_000_000;
  }

  /**
   * No-op for link support.
   */
  addLink(): AiSpan {
    return this;
  }

  /**
   * No-op for links support.
   */
  addLinks(): AiSpan {
    return this;
  }

  /**
   * Sets the span status.
   */
  setStatus(status: { code: number; message?: string }): AiSpan {
    if (!this.ended) {
      this.status = {
        code: status.code as AiSpanStatusCode,
        message: status.message,
      };
    }
    return this;
  }

  /**
   * Updates the span name.
   */
  updateName(name: string): AiSpan {
    if (!this.ended) {
      this.prefactorSpan.name = name;
    }
    return this;
  }

  /**
   * Ends the span and sends it to the Prefactor platform.
   */
  end(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;

    // Categorize accumulated attributes
    const { inputs, outputs, metadata, tokenUsage } = categorizeAttributes(this.attributes);

    // Merge with existing inputs (from span creation)
    const finalInputs = { ...this.prefactorSpan.inputs, ...inputs };

    // Add metadata to span
    Object.assign(this.prefactorSpan.metadata, metadata);

    // End the span via Prefactor tracer
    this.prefactorTracer.endSpan(this.prefactorSpan, {
      outputs: Object.keys(outputs).length > 0 ? outputs : undefined,
      error: this.error ?? undefined,
      tokenUsage: tokenUsage ?? undefined,
    });

    // Update inputs on the span object (for completeness)
    this.prefactorSpan.inputs = finalInputs;
  }

  /**
   * Checks if still recording.
   */
  isRecording(): boolean {
    return !this.ended;
  }

  /**
   * Records an exception.
   */
  recordException(error: Error): void {
    if (!this.ended) {
      this.error = error;
      this.status = {
        code: AiSpanStatusCode.ERROR,
        message: error.message,
      };
      // Also add as an event
      this.addEvent('exception', {
        'exception.type': error.name,
        'exception.message': error.message,
        'exception.stacktrace': error.stack,
      });
    }
  }

  /**
   * Gets the underlying Prefactor span.
   * @internal
   */
  getPrefactorSpan(): PrefactorSpan {
    return this.prefactorSpan;
  }
}

// ============================================================================
// AiTracerAdapter
// ============================================================================

/**
 * Adapter that wraps a Prefactor Tracer with an OpenTelemetry-compatible interface.
 *
 * This class is the main entry point for AI SDK integration, providing the
 * tracer interface expected by experimental_telemetry.
 */
export class AiTracerAdapter implements AiTracer {
  /**
   * Creates a new AiTracerAdapter.
   *
   * @param prefactorTracer - The underlying Prefactor tracer
   */
  constructor(private prefactorTracer: PrefactorTracer) {}

  /**
   * Creates and starts a new span.
   */
  startSpan(name: string, options?: AiSpanOptions, _context?: unknown): AiSpan {
    // Get parent span from context
    const parentSpan = SpanContext.getCurrent();

    // Infer span type from name
    const spanType = inferSpanType(name);

    // Extract initial attributes as inputs
    const initialInputs: Record<string, unknown> = {};
    if (options?.attributes) {
      for (const [key, value] of Object.entries(options.attributes)) {
        if (INPUT_ATTRIBUTES.has(key)) {
          initialInputs[key] = value;
        }
      }
    }

    // Create the Prefactor span
    const prefactorSpan = this.prefactorTracer.startSpan({
      name,
      spanType,
      inputs: initialInputs,
      parentSpanId: parentSpan?.spanId,
      traceId: parentSpan?.traceId,
    });

    // Create and return the adapter
    const adapter = new AiSpanAdapter(prefactorSpan, this.prefactorTracer);

    // Set initial attributes (non-input ones)
    if (options?.attributes) {
      adapter.setAttributes(options.attributes);
    }

    return adapter;
  }

  /**
   * Creates a span and executes a function within its context.
   *
   * Handles both sync and async functions, automatically ending the span
   * when the function completes.
   */
  startActiveSpan<T>(
    name: string,
    arg2?: AiSpanOptions | ((span: AiSpan) => T),
    arg3?: unknown | ((span: AiSpan) => T),
    arg4?: (span: AiSpan) => T
  ): T {
    // Parse overloaded arguments
    let options: AiSpanOptions | undefined;
    let fn: ((span: AiSpan) => T) | undefined;

    if (typeof arg2 === 'function') {
      fn = arg2;
    } else if (typeof arg3 === 'function') {
      options = arg2 as AiSpanOptions;
      fn = arg3 as (span: AiSpan) => T;
    } else if (typeof arg4 === 'function') {
      options = arg2 as AiSpanOptions;
      fn = arg4;
    }

    if (!fn) {
      throw new Error('startActiveSpan requires a callback function');
    }

    // Create the span
    const span = this.startSpan(name, options) as AiSpanAdapter;
    const prefactorSpan = span.getPrefactorSpan();

    let isAsync = false;

    try {
      // Run the function within the span context
      const result = SpanContext.run(prefactorSpan, () => fn(span));

      // Handle Promise return values
      if (result instanceof Promise) {
        isAsync = true;
        return result
          .then((value) => {
            span.end();
            return value;
          })
          .catch((error) => {
            span.recordException(error);
            span.end();
            throw error;
          }) as T;
      }

      return result;
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      // End synchronous spans in finally
      if (!isAsync) {
        span.end();
      }
    }
  }

  /**
   * Gets the underlying Prefactor tracer.
   * @internal
   */
  getPrefactorTracer(): PrefactorTracer {
    return this.prefactorTracer;
  }
}
