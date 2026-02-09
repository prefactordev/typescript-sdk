import type { Queue, QueueGetResult } from './base.js';

type QueueEntry<T> = {
  item: T;
};

export class InMemoryQueue<T> implements Queue<T> {
  private items: QueueEntry<T>[] = [];
  private waiters: Array<(result: QueueGetResult<T>) => void> = [];
  private isClosed = false;

  async put(item: T): Promise<void> {
    if (this.isClosed) {
      throw new Error('Cannot put item into a closed queue');
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, item });
      return;
    }

    this.items.push({ item });
  }

  async get(): Promise<QueueGetResult<T>> {
    if (this.items.length > 0) {
      const entry = this.items.shift();
      if (entry) {
        return { done: false, item: entry.item };
      }
    }

    if (this.isClosed) {
      return { done: true };
    }

    return new Promise<QueueGetResult<T>>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter({ done: true });
      }
    }
  }

  size(): number {
    return this.items.length;
  }
}
