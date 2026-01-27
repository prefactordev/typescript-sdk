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

    expect(transport.batches.length).toBeGreaterThan(0);
    expect(transport.batches[0].length).toBeLessThanOrEqual(2);
  });
});
