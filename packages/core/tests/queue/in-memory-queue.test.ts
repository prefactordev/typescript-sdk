import { describe, expect, test } from 'bun:test';
import { InMemoryQueue } from '../../src/queue/in-memory';

describe('InMemoryQueue', () => {
  test('enqueue/dequeue preserves FIFO order', () => {
    const queue = new InMemoryQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);

    expect(queue.dequeueBatch(2)).toEqual([1, 2]);
    expect(queue.dequeueBatch(2)).toEqual([3]);
    expect(queue.dequeueBatch(1)).toEqual([]);
  });
});
