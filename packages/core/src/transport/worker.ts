import type { Queue } from '../queue/base.js';
import type { QueueAction } from '../queue/actions.js';
import type { Transport } from './base.js';

type WorkerConfig = { batchSize: number; intervalMs: number };

export class TransportWorker {
  private closed = false;
  private inFlightPromise: Promise<void> | null = null;
  private loopPromise: Promise<void>;

  constructor(
    private queue: Queue<QueueAction>,
    private transport: Transport,
    private config: WorkerConfig
  ) {
    this.loopPromise = this.start();
  }

  private async start(): Promise<void> {
    while (!this.closed) {
      const batch = this.queue.dequeueBatch(this.config.batchSize);
      if (batch.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
        continue;
      }

      try {
        const inFlight = this.transport.processBatch(batch);
        this.inFlightPromise = inFlight;
        await inFlight;
      } catch (error) {
        console.error('TransportWorker.processBatch failed', error);
        await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
      } finally {
        this.inFlightPromise = null;
      }
    }
  }

  async flush(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while ((this.queue.size() > 0 || this.inFlightPromise) && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.loopPromise;
    await this.transport.close();
  }
}
