import type { QueueAction } from '../queue/actions.js';

/**
 * Transport interface for emitting spans to different backends
 *
 * Transports are responsible for sending span data to a destination
 * (e.g., stdout, HTTP API). They implement the strategy pattern to allow
 * pluggable backends.
 */
export interface Transport {
  processBatch(items: QueueAction[]): Promise<void>;

  /**
   * Close the transport and flush any pending data
   *
   * @returns Promise that resolves when the transport is fully closed
   */
  close(): void | Promise<void>;
}
