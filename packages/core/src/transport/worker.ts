import type { Queue } from '../queue/base.js';
import type { QueueAction } from '../queue/actions.js';
import type { Transport } from './base.js';

type WorkerConfig = { batchSize: number; intervalMs: number };

export class TransportWorker {
  private closed = false;

  constructor(
    private queue: Queue<QueueAction>,
    private transport: Transport,
    private config: WorkerConfig
  ) {
    this.start();
  }

  private async start(): Promise<void> {
    while (!this.closed) {
      const batch = this.queue.dequeueBatch(this.config.batchSize);
      if (batch.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
        continue;
      }

      await this.transport.processBatch(batch);
    }
  }

  async flush(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (this.queue.size() > 0 && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.transport.close();
  }
}
