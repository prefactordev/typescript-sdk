/**
 * @fileoverview OpenTelemetry-compatible type definitions for AI SDK integration.
 *
 * This module defines the interfaces expected by the Vercel AI SDK's
 * experimental_telemetry feature, along with re-exports of relevant
 * types from @prefactor/core.
 *
 * @module types
 * @packageDocumentation
 */

// Re-export core types that consumers might need
export {
  type Config,
  type HttpTransportConfig,
  SpanType,
  SpanStatus,
  type Span as PrefactorSpan,
  type TokenUsage,
  type ErrorInfo,
} from '@prefactor/core';

// ============================================================================
// OpenTelemetry-Compatible Span Context
// ============================================================================

/**
 * Context information that uniquely identifies a span within a trace.
 *
 * Compatible with OpenTelemetry's SpanContext interface.
 */
export interface OtelSpanContext {
  /** The trace ID (32-char hex string in OTEL, but we use pfid format). */
  traceId: string;

  /** The span ID (16-char hex string in OTEL, but we use pfid format). */
  spanId: string;

  /** Trace flags (1 = sampled, 0 = not sampled). */
  traceFlags: number;
}

/**
 * Status codes for span completion.
 */
export enum OtelSpanStatusCode {
  /** Default status - not explicitly set. */
  UNSET = 0,
  /** Operation completed successfully. */
  OK = 1,
  /** Operation encountered an error. */
  ERROR = 2,
}

/**
 * Status information for a span.
 */
export interface OtelSpanStatus {
  /** The status code. */
  code: OtelSpanStatusCode;
  /** Optional status message (typically for errors). */
  message?: string;
}

// ============================================================================
// OpenTelemetry-Compatible Span Interface
// ============================================================================

/**
 * OpenTelemetry-compatible Span interface.
 *
 * This interface matches what the Vercel AI SDK expects from a tracer's span.
 * It provides methods for setting attributes, recording events, and ending the span.
 */
export interface OtelSpan {
  /**
   * Returns the span context containing trace and span identifiers.
   */
  spanContext(): OtelSpanContext;

  /**
   * Sets a single attribute on the span.
   *
   * @param key - Attribute key
   * @param value - Attribute value
   * @returns This span for method chaining
   */
  setAttribute(key: string, value: unknown): OtelSpan;

  /**
   * Sets multiple attributes on the span.
   *
   * @param attributes - Key-value pairs to set
   * @returns This span for method chaining
   */
  setAttributes(attributes: Record<string, unknown>): OtelSpan;

  /**
   * Adds a timed event to the span.
   *
   * @param name - Event name
   * @param attributes - Optional event attributes
   * @returns This span for method chaining
   */
  addEvent(name: string, attributes?: Record<string, unknown>): OtelSpan;

  /**
   * Adds a link to another span (no-op in this implementation).
   * @returns This span for method chaining
   */
  addLink(): OtelSpan;

  /**
   * Adds multiple links to other spans (no-op in this implementation).
   * @returns This span for method chaining
   */
  addLinks(): OtelSpan;

  /**
   * Sets the status of the span.
   *
   * @param status - Status to set
   * @returns This span for method chaining
   */
  setStatus(status: OtelSpanStatus): OtelSpan;

  /**
   * Updates the name of the span.
   *
   * @param name - New span name
   * @returns This span for method chaining
   */
  updateName(name: string): OtelSpan;

  /**
   * Marks the span as complete.
   */
  end(): void;

  /**
   * Checks if the span is still recording.
   *
   * @returns true if the span has not been ended
   */
  isRecording(): boolean;

  /**
   * Records an exception that occurred during the span's operation.
   *
   * @param error - The error to record
   */
  recordException(error: Error): void;
}

// ============================================================================
// OpenTelemetry-Compatible Span Options
// ============================================================================

/**
 * Options for creating a new span.
 */
export interface OtelSpanOptions {
  /**
   * The span kind (CLIENT, SERVER, INTERNAL, etc.).
   * See OpenTelemetry SpanKind for values.
   */
  kind?: number;

  /**
   * Initial attributes to set on the span.
   */
  attributes?: Record<string, unknown>;

  /**
   * Override the default start time.
   */
  startTime?: number | Date | [number, number];
}

// ============================================================================
// OpenTelemetry-Compatible Tracer Interface
// ============================================================================

/**
 * OpenTelemetry-compatible Tracer interface.
 *
 * This interface matches what the Vercel AI SDK expects from a tracer.
 */
export interface OtelTracer {
  /**
   * Creates and starts a new span.
   *
   * @param name - The span name
   * @param options - Optional span configuration
   * @param context - Optional parent context (ignored, we use SpanContext)
   * @returns A new span
   */
  startSpan(name: string, options?: OtelSpanOptions, context?: unknown): OtelSpan;

  /**
   * Creates a span and executes a function within its context.
   *
   * @param name - The span name
   * @param fn - Function to execute
   * @returns The function's return value
   */
  startActiveSpan<T>(name: string, fn: (span: OtelSpan) => T): T;

  /**
   * Creates a span with options and executes a function within its context.
   *
   * @param name - The span name
   * @param options - Span configuration
   * @param fn - Function to execute
   * @returns The function's return value
   */
  startActiveSpan<T>(name: string, options: OtelSpanOptions, fn: (span: OtelSpan) => T): T;

  /**
   * Creates a span with options and context, executing a function within it.
   *
   * @param name - The span name
   * @param options - Span configuration
   * @param context - Parent context
   * @param fn - Function to execute
   * @returns The function's return value
   */
  startActiveSpan<T>(
    name: string,
    options: OtelSpanOptions,
    context: unknown,
    fn: (span: OtelSpan) => T
  ): T;
}
