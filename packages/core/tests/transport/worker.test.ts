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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};


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
    const batchDeferred = createDeferred<void>();
    const batchStarted = createDeferred<void>();
    const transport = {
      batches: [] as QueueAction[][],
      async processBatch(items: QueueAction[]): Promise<void> {
        this.batches.push(items);
        batchStarted.resolve();
        await batchDeferred.promise;
      },
      async close(): Promise<void> {},
    };
    const worker = new TransportWorker(queue, transport, { batchSize: 2, intervalMs: 1 });

    queue.enqueue({ type: 'agent_finish', data: {} });

    let flushResolved = false;
    const flushPromise = worker.flush(100).then(() => {
      flushResolved = true;
    });

    await batchStarted.promise;

    expect(flushResolved).toBe(false);

    batchDeferred.resolve();
    await flushPromise;

    expect(flushResolved).toBe(true);
  });

  test('retries failed batches without dropping items', async () => {
    const queue = new InMemoryQueue<QueueAction>();
    const firstAttempt = createDeferred<void>();
    const firstAttemptStarted = createDeferred<void>();
    const secondAttemptStarted = createDeferred<void>();
    const transport = {
      batches: [] as QueueAction[][],
      attempt: 0,
      async processBatch(items: QueueAction[]): Promise<void> {
        this.batches.push(items);
        this.attempt += 1;
        if (this.attempt === 1) {
          firstAttemptStarted.resolve();
          return firstAttempt.promise;
        }
        secondAttemptStarted.resolve();
      },
      async close(): Promise<void> {},
    };
    const worker = new TransportWorker(queue, transport, { batchSize: 5, intervalMs: 1 });

    queue.enqueue({ type: 'agent_finish', data: {} });

    await firstAttemptStarted.promise;
    firstAttempt.reject(new Error('boom'));

    await secondAttemptStarted.promise;
    await worker.flush(100);

    expect(transport.batches.length).toBe(2);
    expect(transport.batches[0]).toEqual(transport.batches[1]);
    expect(transport.batches[0]?.length).toBe(1);
  });

  test('flush waits for pending batch retry to finish', async () => {
    const queue = new InMemoryQueue<QueueAction>();
    const firstAttempt = createDeferred<void>();
    const firstAttemptStarted = createDeferred<void>();
    const secondAttemptStarted = createDeferred<void>();
    const secondAttempt = createDeferred<void>();
    const transport = {
      attempt: 0,
      async processBatch(): Promise<void> {
        this.attempt += 1;
        if (this.attempt === 1) {
          firstAttemptStarted.resolve();
          return firstAttempt.promise;
        }
        secondAttemptStarted.resolve();
        await secondAttempt.promise;
      },
      async close(): Promise<void> {},
    };
    const worker = new TransportWorker(queue, transport, { batchSize: 1, intervalMs: 1 });

    queue.enqueue({ type: 'agent_finish', data: {} });

    let flushResolved = false;
    const flushPromise = worker.flush(100).then(() => {
      flushResolved = true;
    });

    await firstAttemptStarted.promise;
    firstAttempt.reject(new Error('boom'));

    await secondAttemptStarted.promise;

    expect(flushResolved).toBe(false);

    secondAttempt.resolve();
    await flushPromise;

    expect(flushResolved).toBe(true);
  });

  test('close drains pending batch before finishing', async () => {
    const queue = new InMemoryQueue<QueueAction>();
    const firstAttempt = createDeferred<void>();
    const firstAttemptStarted = createDeferred<void>();
    const secondAttemptStarted = createDeferred<void>();
    const secondAttempt = createDeferred<void>();
    const transport = {
      attempt: 0,
      async processBatch(): Promise<void> {
        this.attempt += 1;
        if (this.attempt === 1) {
          firstAttemptStarted.resolve();
          return firstAttempt.promise;
        }
        secondAttemptStarted.resolve();
        await secondAttempt.promise;
      },
      async close(): Promise<void> {},
    };
    const worker = new TransportWorker(queue, transport, { batchSize: 1, intervalMs: 1 });

    queue.enqueue({ type: 'agent_finish', data: {} });

    await firstAttemptStarted.promise;
    firstAttempt.reject(new Error('boom'));

    let closeResolved = false;
    const closePromise = worker.close(100).then(() => {
      closeResolved = true;
    });

    await secondAttemptStarted.promise;
    expect(closeResolved).toBe(false);

    secondAttempt.resolve();
    await closePromise;

    expect(transport.attempt).toBe(2);
  });

  test('close resolves after loop timeout even if transport close never resolves', async () => {
    const queue = new InMemoryQueue<QueueAction>();
    const batchStarted = createDeferred<void>();
    const closeCalled = createDeferred<void>();
    const closeBlocked = createDeferred<void>();
    const transport = {
      async processBatch(): Promise<void> {
        batchStarted.resolve();
        return new Promise(() => {});
      },
      async close(): Promise<void> {
        closeCalled.resolve();
        await closeBlocked.promise;
      },
    };
    const worker = new TransportWorker(queue, transport, { batchSize: 1, intervalMs: 1 });

    queue.enqueue({ type: 'agent_finish', data: {} });
    await batchStarted.promise;

    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map(String).join(' '));
    };

    let closeResolved = false;
    const closePromise = worker.close(0).then(() => {
      closeResolved = true;
    });
    await closeCalled.promise;
    await closePromise;

    console.warn = originalWarn;

    expect(warnMessages.some((message) => message.includes('potential data loss'))).toBe(true);
    expect(closeResolved).toBe(true);
  });
});
