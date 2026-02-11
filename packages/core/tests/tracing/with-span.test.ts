import { describe, expect, test } from 'bun:test';
import { SpanStatus, SpanType, withSpan } from '../../src/index';
import type { Span } from '../../src/tracing/span';
import type { Tracer } from '../../src/tracing/tracer';

function createSpan(): Span {
  return {
    spanId: 'span-1',
    parentSpanId: null,
    traceId: 'trace-1',
    name: 'test',
    spanType: SpanType.CHAIN,
    startTime: Date.now(),
    endTime: null,
    status: SpanStatus.RUNNING,
    inputs: {},
    outputs: null,
    tokenUsage: null,
    error: null,
    metadata: {},
  };
}

describe('withSpan', () => {
  test('ends span with returned value in outputs', async () => {
    const span = createSpan();
    const ended: Array<{ span: Span; outputs?: Record<string, unknown> }> = [];

    const tracer = {
      startSpan: () => span,
      endSpan: (endedSpan, options) => {
        ended.push({ span: endedSpan, outputs: options?.outputs });
      },
    } as unknown as Tracer;

    const result = await withSpan(
      tracer,
      {
        name: 'custom',
        spanType: 'custom:normalize-response',
        inputs: {},
      },
      async () => 'normalized text'
    );

    expect(result).toBe('normalized text');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.outputs).toEqual({ result: 'normalized text' });
  });
});
