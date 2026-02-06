import type { Span } from '../tracing/span.js';
import { serializeValue } from '../utils/serialization.js';
import type { AgentInstanceOptions, Transport } from './base.js';

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
  emit(span: Span): void {
    if (this.closed) {
      return;
    }

    const item = { type: 'span_end', data: span };

    this.writeLock = this.writeLock.then(async () => {
      try {
        const serialized = serializeValue(item);
        const json = JSON.stringify(serialized);
        process.stdout.write(`::PREFACTOR::${json}\n`);
      } catch (error) {
        console.error('Failed to emit span to stdout:', error);
      }
    });
  }

  finishSpan(spanId: string, endTime: number): void {
    if (this.closed) {
      return;
    }

    const item = { type: 'span_finish', data: { spanId, endTime } };
    this.writeLock = this.writeLock.then(async () => {
      try {
        const serialized = serializeValue(item);
        const json = JSON.stringify(serialized);
        process.stdout.write(`::PREFACTOR::${json}\n`);
      } catch (error) {
        console.error('Failed to emit span finish to stdout:', error);
      }
    });
  }

  startAgentInstance(options?: AgentInstanceOptions): void {
    if (this.closed) {
      return;
    }

    const item = { type: 'agent_start', data: options ?? {} };
    this.writeLock = this.writeLock.then(async () => {
      try {
        const serialized = serializeValue(item);
        const json = JSON.stringify(serialized);
        process.stdout.write(`::PREFACTOR::${json}\n`);
      } catch (error) {
        console.error('Failed to emit agent start to stdout:', error);
      }
    });
  }

  finishAgentInstance(): void {
    if (this.closed) {
      return;
    }

    const item = { type: 'agent_finish', data: {} };
    this.writeLock = this.writeLock.then(async () => {
      try {
        const serialized = serializeValue(item);
        const json = JSON.stringify(serialized);
        process.stdout.write(`::PREFACTOR::${json}\n`);
      } catch (error) {
        console.error('Failed to emit agent finish to stdout:', error);
      }
    });
  }

  registerSchema(schema: Record<string, unknown>): void {
    if (this.closed) {
      return;
    }

    const item = { type: 'schema_register', data: { schema } };
    this.writeLock = this.writeLock.then(async () => {
      try {
        const serialized = serializeValue(item);
        const json = JSON.stringify(serialized);
        process.stdout.write(`::PREFACTOR::${json}\n`);
      } catch (error) {
        console.error('Failed to emit schema register to stdout:', error);
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.writeLock;
  }
}
