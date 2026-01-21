import type { Span } from '../tracing/span.js';
import { serializeValue } from '../utils/serialization.js';
import type { Transport } from './base.js';

/**
 * STDIO transport emits spans as newline-delimited JSON to stdout.
 *
 * This is the default transport and requires no configuration.
 * It's useful for local development and for piping span data to other tools.
 *
 * Features:
 * - Newline-delimited JSON output
 * - Promise-based write locking for ordering
 * - Graceful error handling
 *
 * @example
 * ```typescript
 * const transport = new StdioTransport();
 * const tracer = new Tracer(transport);
 * ```
 */
export class StdioTransport implements Transport {
  private closed = false;
  private writeLock = Promise.resolve();

  /**
   * Emit a span to stdout as JSON
   *
   * @param span - The span to emit
   */
  emit(span: Span): void {
    if (this.closed) {
      return;
    }

    // Queue write to maintain ordering
    this.writeLock = this.writeLock.then(async () => {
      try {
        const serialized = serializeValue(span);
        const json = JSON.stringify(serialized);
        await Bun.write(Bun.stdout, `${json}\n`);
      } catch (error) {
        console.error('Failed to emit span to stdout:', error);
      }
    });
  }

  /**
   * No-op for stdio transport (not applicable)
   */
  finishSpan(): void {
    // No-op for stdio transport
  }

  /**
   * No-op for stdio transport (not applicable)
   */
  startAgentInstance(): void {
    // No-op for stdio transport
  }

  /**
   * No-op for stdio transport (not applicable)
   */
  finishAgentInstance(): void {
    // No-op for stdio transport
  }

  /**
   * Close the transport and wait for pending writes to complete
   *
   * @returns Promise that resolves when all writes are complete
   */
  async close(): Promise<void> {
    this.closed = true;
    await this.writeLock;
  }
}
