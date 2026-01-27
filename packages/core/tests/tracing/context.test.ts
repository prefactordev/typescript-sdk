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
});
