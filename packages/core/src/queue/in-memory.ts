import type { Queue } from './base.js';

export class InMemoryQueue<T> implements Queue<T> {
  private items: T[] = [];

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeueBatch(maxItems: number): T[] {
    if (this.items.length === 0) return [];
    return this.items.splice(0, maxItems);
  }

  size(): number {
    return this.items.length;
  }

  async flush(): Promise<void> {
    return;
  }
}
