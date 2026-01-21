import type { Span } from '../tracing/span.js';

/**
 * Transport interface for emitting spans to different backends
 *
 * Transports are responsible for sending span data to a destination
 * (e.g., stdout, HTTP API). They implement the strategy pattern to allow
 * pluggable backends.
 */
export interface Transport {
  /**
   * Emit a span to the transport destination
   *
   * @param span - The span to emit
   */
  emit(span: Span): void;

  /**
   * Finish a previously emitted span (for long-running spans like AGENT spans)
   *
   * @param spanId - ID of the span to finish
   * @param endTime - End time in milliseconds since Unix epoch
   */
  finishSpan(spanId: string, endTime: number): void;

  /**
   * Signal the start of an agent instance execution
   */
  startAgentInstance(): void;

  /**
   * Signal the completion of an agent instance execution
   */
  finishAgentInstance(): void;

  /**
   * Close the transport and flush any pending data
   *
   * @returns Promise that resolves when the transport is fully closed
   */
  close(): void | Promise<void>;
}
