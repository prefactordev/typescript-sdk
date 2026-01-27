import type { Queue } from '../queue/base.js';
import type { QueueAction } from '../queue/actions.js';
import type { Transport } from './base.js';

type WorkerConfig = { batchSize: number; intervalMs: number };

export class TransportWorker {
  private closed = false;
  private inFlightPromise: Promise<void> | null = null;
  private loopPromise: Promise<void>;
  private pendingBatch: QueueAction[] | null = null;

  constructor(
    private queue: Queue<QueueAction>,
    private transport: Transport,
    private config: WorkerConfig
  ) {
    this.loopPromise = this.start();
  }

  private async start(): Promise<void> {
    while (!this.closed || this.pendingBatch || this.queue.size() > 0 || this.inFlightPromise) {
      const batch = this.pendingBatch ?? this.queue.dequeueBatch(this.config.batchSize);
      if (batch.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
        continue;
      }

      try {
        const inFlight = this.transport.processBatch(batch);
        this.inFlightPromise = inFlight;
        await inFlight;
        this.pendingBatch = null;
      } catch (error) {
        this.pendingBatch = batch;
        console.error('TransportWorker.processBatch failed', error);
        await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
      } finally {
        this.inFlightPromise = null;
      }
    }
  }

  async flush(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (
      (this.queue.size() > 0 || this.pendingBatch || this.inFlightPromise) &&
      Date.now() - start < timeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
    }
  }

  async close(timeoutMs = this.config.intervalMs * 50): Promise<void> {
    this.closed = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<false>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), timeoutMs);
    });
    const loopPromise = this.loopPromise.then(() => true);
    const loopCompleted = await Promise.race([loopPromise, timeoutPromise]);
    if (loopCompleted && timeoutId) {
      clearTimeout(timeoutId);
    }
    if (!loopCompleted) {
      console.warn('TransportWorker.close timed out waiting for loop to finish');
    }
    if (loopCompleted) {
      await this.transport.close();
    }
  }
}
