import type { Span } from '../tracing/span.js';

export type AgentInstanceOptions = {
  agentId?: string;
  agentIdentifier?: string;
  agentName?: string;
  agentDescription?: string;
};

/**
 * Transport interface for emitting spans to different backends
 *
 * Transports are responsible for sending span data to a destination
 * (e.g., stdout, HTTP API). They implement the strategy pattern to allow
 * pluggable backends.
 */
export interface Transport {
  emit(span: Span): void;

  finishSpan(spanId: string, endTime: number): void;

  startAgentInstance(options?: AgentInstanceOptions): void;

  finishAgentInstance(): void;

  registerSchema(schema: Record<string, unknown>): void;

  /**
   * Close the transport and flush any pending data
   *
   * @returns Promise that resolves when the transport is fully closed
   */
  close(): void | Promise<void>;
}
