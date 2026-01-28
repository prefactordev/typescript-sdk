import { describe, expect, test } from 'bun:test';
import { SpanContext } from '../../src/tracing/context';
import type { Span } from '../../src/tracing/span.js';
import { SpanStatus, SpanType } from '../../src/tracing/span.js';

const createSpan = (spanId: string): Span => ({
  spanId,
  parentSpanId: null,
  traceId: 'trace',
  name: spanId,
  spanType: SpanType.CHAIN,
  startTime: 0,
  endTime: null,
  status: SpanStatus.RUNNING,
  inputs: {},
  outputs: null,
  tokenUsage: null,
  error: null,
  metadata: {},
  tags: [],
});

describe('SpanContext', () => {
  test('push/pop manages stack', () => {
    SpanContext.clear();
    expect(SpanContext.getCurrent()).toBeUndefined();

    SpanContext.enter(createSpan('1'));
    SpanContext.enter(createSpan('2'));

    expect(SpanContext.getCurrent()?.spanId).toBe('2');
    SpanContext.exit();
    expect(SpanContext.getCurrent()?.spanId).toBe('1');
  });

  test('getStack returns a shallow copy', () => {
    SpanContext.clear();
    SpanContext.enter(createSpan('1'));

    const stack = SpanContext.getStack();
    stack.push(createSpan('2'));

    expect(SpanContext.getCurrent()?.spanId).toBe('1');
    expect(SpanContext.getStack()).toHaveLength(1);
  });

  test('run restores stack across nested contexts', () => {
    SpanContext.clear();

    const seen: Array<string | undefined> = [];
    const span1 = createSpan('1');
    const span2 = createSpan('2');

    SpanContext.run(span1, () => {
      seen.push(SpanContext.getCurrent()?.spanId);

      SpanContext.run(span2, () => {
        seen.push(SpanContext.getCurrent()?.spanId);
      });

      seen.push(SpanContext.getCurrent()?.spanId);
    });

    expect(seen).toEqual(['1', '2', '1']);
    expect(SpanContext.getCurrent()).toBeUndefined();
  });

  test('runAsync restores stack across nested contexts and awaits', async () => {
    SpanContext.clear();

    const seen: Array<string | undefined> = [];
    const span1 = createSpan('1');
    const span2 = createSpan('2');

    await SpanContext.runAsync(span1, async () => {
      seen.push(SpanContext.getCurrent()?.spanId);
      await Promise.resolve();

      await SpanContext.runAsync(span2, async () => {
        seen.push(SpanContext.getCurrent()?.spanId);
        await Promise.resolve();
      });

      seen.push(SpanContext.getCurrent()?.spanId);
      await Promise.resolve();
    });

    expect(seen).toEqual(['1', '2', '1']);
    expect(SpanContext.getCurrent()).toBeUndefined();
  });

  test('runAsync isolates sibling branch stacks', async () => {
    SpanContext.clear();

    const root = createSpan('root');
    const spanA = createSpan('A');
    const spanB = createSpan('B');

    const defer = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((resolver) => {
        resolve = resolver;
      });
      return { promise, resolve };
    };

    await SpanContext.runAsync(root, async () => {
      const stacks: { a?: string[]; b?: string[] } = {};
      const aStarted = defer();
      const bStarted = defer();
      const allowRead = defer();

      const branchA = SpanContext.runAsync(spanA, async () => {
        aStarted.resolve();
        await bStarted.promise;
        await allowRead.promise;
        stacks.a = SpanContext.getStack().map((span) => span.spanId);
      });

      const branchB = SpanContext.runAsync(spanB, async () => {
        bStarted.resolve();
        await aStarted.promise;
        await allowRead.promise;
        stacks.b = SpanContext.getStack().map((span) => span.spanId);
      });

      await Promise.all([aStarted.promise, bStarted.promise]);
      allowRead.resolve();

      await Promise.all([branchA, branchB]);

      expect(stacks.a).toEqual(['root', 'A']);
      expect(stacks.b).toEqual(['root', 'B']);
    });
  });
});
