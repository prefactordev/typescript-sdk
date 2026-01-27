import type { QueueAction } from '../queue/actions.js';
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
   * Emit a batch of queue actions to stdout as newline-delimited JSON
   *
   * @param items - The queue actions to emit
   */
  async processBatch(items: QueueAction[]): Promise<void> {
    if (this.closed || items.length === 0) {
      return;
    }

    // Queue write to maintain ordering
    this.writeLock = this.writeLock.then(async () => {
      for (const item of items) {
        try {
          const serialized = serializeValue(item);
          const json = JSON.stringify(serialized);
          await Bun.write(Bun.stdout, `${json}\n`);
        } catch (error) {
          console.error('Failed to emit queue action to stdout:', error);
        }
      }
    });

    await this.writeLock;
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
