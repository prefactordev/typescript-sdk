import { describe, expect, test } from 'bun:test';
import { InMemoryQueue } from '../../src/queue/in-memory';
import type { QueueAction } from '../../src/queue/actions';
import { TransportWorker } from '../../src/transport/worker';

class MockTransport {
  public batches: QueueAction[][] = [];
  async processBatch(items: QueueAction[]): Promise<void> {
    this.batches.push(items);
  }
  async close(): Promise<void> {}
}

describe('TransportWorker', () => {
  test('drains queued actions in batches', async () => {
    const queue = new InMemoryQueue<QueueAction>();
    const transport = new MockTransport();
    const worker = new TransportWorker(queue, transport, { batchSize: 2, intervalMs: 1 });

    queue.enqueue({ type: 'agent_finish', data: {} });
    queue.enqueue({ type: 'agent_finish', data: {} });
    queue.enqueue({ type: 'agent_finish', data: {} });

    await worker.flush(100);

    const totalItems = transport.batches.reduce((count, batch) => count + batch.length, 0);

    expect(totalItems).toBe(3);
    expect(transport.batches.every((batch) => batch.length <= 2)).toBe(true);
  });

  test('flush waits for in-flight batch completion', async () => {
    const queue = new InMemoryQueue<QueueAction>();
    let resolveBatch: (() => void) | undefined;
    const batchPromise = new Promise<void>((resolve) => {
      resolveBatch = resolve;
    });
    const transport = {
      batches: [] as QueueAction[][],
      async processBatch(items: QueueAction[]): Promise<void> {
        this.batches.push(items);
        await batchPromise;
      },
      async close(): Promise<void> {},
    };
    const worker = new TransportWorker(queue, transport, { batchSize: 2, intervalMs: 1 });

    queue.enqueue({ type: 'agent_finish', data: {} });

    let flushResolved = false;
    const flushPromise = worker.flush(100).then(() => {
      flushResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(flushResolved).toBe(false);

    resolveBatch?.();
    await flushPromise;

    expect(flushResolved).toBe(true);
  });
});
