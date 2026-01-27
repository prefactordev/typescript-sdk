import { describe, expect, test } from 'bun:test';
import { SpanContext } from '../../src/tracing/context';

describe('SpanContext', () => {
  test('push/pop manages stack', () => {
    SpanContext.clear();
    expect(SpanContext.getCurrent()).toBeUndefined();

    SpanContext.enter({ spanId: '1' } as any);
    SpanContext.enter({ spanId: '2' } as any);

    expect(SpanContext.getCurrent()?.spanId).toBe('2');
    SpanContext.exit();
    expect(SpanContext.getCurrent()?.spanId).toBe('1');
  });

  test('getStack returns a shallow copy', () => {
    SpanContext.clear();
    SpanContext.enter({ spanId: '1' } as any);

    const stack = SpanContext.getStack();
    stack.push({ spanId: '2' } as any);

    expect(SpanContext.getCurrent()?.spanId).toBe('1');
    expect(SpanContext.getStack()).toHaveLength(1);
  });

  test('run restores stack across nested contexts', () => {
    SpanContext.clear();

    const seen: Array<string | undefined> = [];
    const span1 = { spanId: '1' } as any;
    const span2 = { spanId: '2' } as any;

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
    const span1 = { spanId: '1' } as any;
    const span2 = { spanId: '2' } as any;

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
});
