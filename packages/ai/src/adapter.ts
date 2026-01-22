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
  OtelSpan,
  OtelSpanContext,
  OtelSpanOptions,
  OtelSpanStatus,
  OtelTracer,
} from './types.js';
import { OtelSpanStatusCode } from './types.js';

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
// OtelSpanAdapter
// ============================================================================

/**
 * Adapter that wraps a Prefactor Span with an OpenTelemetry-compatible interface.
 *
 * This class accumulates attributes during the span's lifetime and maps them
 * to Prefactor's inputs/outputs/metadata when the span ends.
 */
export class OtelSpanAdapter implements OtelSpan {
  /** Accumulated attributes during span lifetime. */
  private attributes: Record<string, unknown> = {};

  /** Whether the span has been ended. */
  private ended = false;

  /** Recorded error, if any. */
  private error: Error | null = null;

  /** The span's status. */
  private status: OtelSpanStatus = { code: OtelSpanStatusCode.UNSET };

  /**
   * Creates a new OtelSpanAdapter.
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
  spanContext(): OtelSpanContext {
    return {
      traceId: this.prefactorSpan.traceId,
      spanId: this.prefactorSpan.spanId,
      traceFlags: 1, // Always sampled
    };
  }

  /**
   * Sets a single attribute.
   */
  setAttribute(key: string, value: unknown): OtelSpan {
    if (!this.ended) {
      this.attributes[key] = value;
    }
    return this;
  }

  /**
   * Sets multiple attributes.
   */
  setAttributes(attributes: Record<string, unknown>): OtelSpan {
    if (!this.ended) {
      Object.assign(this.attributes, attributes);
    }
    return this;
  }

  /**
   * Adds a timed event (stored in metadata).
   */
  addEvent(name: string, attributes?: Record<string, unknown>): OtelSpan {
    if (!this.ended) {
      // Store events in metadata as an array
      const events = (this.attributes['_events'] as Array<unknown>) ?? [];
      events.push({
        name,
        timestamp: Date.now(),
        attributes,
      });
      this.attributes['_events'] = events;
    }
    return this;
  }

  /**
   * No-op for link support.
   */
  addLink(): OtelSpan {
    return this;
  }

  /**
   * No-op for links support.
   */
  addLinks(): OtelSpan {
    return this;
  }

  /**
   * Sets the span status.
   */
  setStatus(status: OtelSpanStatus): OtelSpan {
    if (!this.ended) {
      this.status = status;
    }
    return this;
  }

  /**
   * Updates the span name.
   */
  updateName(name: string): OtelSpan {
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
        code: OtelSpanStatusCode.ERROR,
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
// OtelTracerAdapter
// ============================================================================

/**
 * Adapter that wraps a Prefactor Tracer with an OpenTelemetry-compatible interface.
 *
 * This class is the main entry point for AI SDK integration, providing the
 * tracer interface expected by experimental_telemetry.
 */
export class OtelTracerAdapter implements OtelTracer {
  /**
   * Creates a new OtelTracerAdapter.
   *
   * @param prefactorTracer - The underlying Prefactor tracer
   */
  constructor(private prefactorTracer: PrefactorTracer) {}

  /**
   * Creates and starts a new span.
   */
  startSpan(name: string, options?: OtelSpanOptions, _context?: unknown): OtelSpan {
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
    const adapter = new OtelSpanAdapter(prefactorSpan, this.prefactorTracer);

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
    arg2?: OtelSpanOptions | ((span: OtelSpan) => T),
    arg3?: unknown | ((span: OtelSpan) => T),
    arg4?: (span: OtelSpan) => T
  ): T {
    // Parse overloaded arguments
    let options: OtelSpanOptions | undefined;
    let fn: ((span: OtelSpan) => T) | undefined;

    if (typeof arg2 === 'function') {
      fn = arg2;
    } else if (typeof arg3 === 'function') {
      options = arg2 as OtelSpanOptions;
      fn = arg3 as (span: OtelSpan) => T;
    } else if (typeof arg4 === 'function') {
      options = arg2 as OtelSpanOptions;
      fn = arg4;
    }

    if (!fn) {
      throw new Error('startActiveSpan requires a callback function');
    }

    // Create the span
    const span = this.startSpan(name, options) as OtelSpanAdapter;
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
