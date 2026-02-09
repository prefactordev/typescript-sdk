import type { Queue, TaskExecutorOptions } from './base.js';

const DEFAULT_WORKER_COUNT = 1;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 0;

export class TaskExecutor<T> {
  private isRunning = false;
  private workerPromises: Promise<void>[] = [];
  private workerCount: number;
  private maxRetries: number;
  private retryDelayMs: number;
  private onError?: (error: unknown, item: T) => void | Promise<void>;

  constructor(
    private queue: Queue<T>,
    private handler: (item: T) => Promise<void>,
    options: TaskExecutorOptions<T> = {}
  ) {
    this.workerCount = Math.max(options.workerCount ?? DEFAULT_WORKER_COUNT, 1);
    this.maxRetries = Math.max(options.maxRetries ?? DEFAULT_MAX_RETRIES, 0);
    this.retryDelayMs = Math.max(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, 0);
    this.onError = options.onError;
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.workerPromises = Array.from({ length: this.workerCount }, () => this.runWorker());
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.queue.close();
    await Promise.all(this.workerPromises);
    this.workerPromises = [];
  }

  private async runWorker(): Promise<void> {
    while (true) {
      const result = await this.queue.get();
      if (result.done) {
        return;
      }

      await this.executeWithRetry(result.item);
    }
  }

  private async executeWithRetry(item: T): Promise<void> {
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        await this.handler(item);
        return;
      } catch (error) {
        if (attempt >= this.maxRetries) {
          await this.safeOnError(error, item);
          return;
        }

        if (this.retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
        }
      }

      attempt += 1;
    }
  }

  private async safeOnError(error: unknown, item: T): Promise<void> {
    if (!this.onError) {
      return;
    }

    try {
      await this.onError(error, item);
    } catch {
      return;
    }
  }
}
