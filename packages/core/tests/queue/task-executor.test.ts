import { describe, expect, test } from 'bun:test';
import { InMemoryQueue } from '../../src/queue/in-memory-queue.js';
import { TaskExecutor } from '../../src/queue/task-executor.js';

describe('TaskExecutor', () => {
  test('processes queued items in insertion order with one worker', async () => {
    const queue = new InMemoryQueue<string>();
    const seen: string[] = [];
    const executor = new TaskExecutor(
      queue,
      async (item) => {
        seen.push(item);
      },
      { workerCount: 1 }
    );

    executor.start();
    await queue.put('a');
    await queue.put('b');
    await executor.stop();

    expect(seen).toEqual(['a', 'b']);
  });

  test('retries a task when handler fails', async () => {
    const queue = new InMemoryQueue<string>();
    let attempts = 0;
    const seen: string[] = [];
    const executor = new TaskExecutor(
      queue,
      async (item) => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('transient failure');
        }
        seen.push(item);
      },
      { workerCount: 1, maxRetries: 2, retryDelayMs: 0 }
    );

    executor.start();
    await queue.put('a');
    await executor.stop();

    expect(attempts).toBe(3);
    expect(seen).toEqual(['a']);
  });

  test('processes undefined items without treating them as stop signal', async () => {
    const queue = new InMemoryQueue<string | undefined>();
    const seen: Array<string | undefined> = [];
    const executor = new TaskExecutor(
      queue,
      async (item) => {
        seen.push(item);
      },
      { workerCount: 1 }
    );

    executor.start();
    await queue.put(undefined);
    await queue.put('b');
    await executor.stop();

    expect(seen).toEqual([undefined, 'b']);
  });

  test('continues processing when onError callback throws', async () => {
    const queue = new InMemoryQueue<string>();
    const attempted: string[] = [];
    const executor = new TaskExecutor(
      queue,
      async (item) => {
        attempted.push(item);
        throw new Error('handler failed');
      },
      {
        workerCount: 1,
        maxRetries: 0,
        onError: () => {
          throw new Error('onError failed');
        },
      }
    );

    executor.start();
    await queue.put('a');
    await queue.put('b');

    await expect(executor.stop()).resolves.toBeUndefined();
    expect(attempted).toEqual(['a', 'b']);
  });
});
