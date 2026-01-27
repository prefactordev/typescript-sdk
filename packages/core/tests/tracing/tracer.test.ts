import { beforeEach, describe, expect, test } from 'bun:test';
import { extractPartition, isPfid, type Partition } from '@prefactor/pfid';
import type { QueueAction } from '../../src/queue/actions';
import type { Queue } from '../../src/queue/base';
import { SpanContext } from '../../src/tracing/context';
import { type Span, SpanStatus, SpanType } from '../../src/tracing/span';
import { Tracer } from '../../src/tracing/tracer';

class MockQueue implements Queue<QueueAction> {
  items: QueueAction[] = [];

  enqueue(item: QueueAction): void {
    this.items.push(item);
  }

  dequeueBatch(maxItems: number): QueueAction[] {
    return this.items.splice(0, maxItems);
  }

  size(): number {
    return this.items.length;
  }

  async flush(): Promise<void> {}
}

describe('Tracer', () => {
  let queue: MockQueue;
  let tracer: Tracer;

  beforeEach(() => {
    queue = new MockQueue();
    tracer = new Tracer(queue);
  });

  test('should create span with required fields', () => {
    const span = tracer.startSpan({
      name: 'test_span',
      spanType: SpanType.LLM,
      inputs: { prompt: 'Hello' },
    });

    expect(span.name).toBe('test_span');
    expect(span.spanType).toBe(SpanType.LLM);
    expect(span.status).toBe(SpanStatus.RUNNING);
    expect(span.spanId).toBeDefined();
    expect(span.traceId).toBeDefined();
    expect(span.inputs).toEqual({ prompt: 'Hello' });
    expect(span.parentSpanId).toBeNull();
  });

  test('should emit agent spans immediately', () => {
    const span = tracer.startSpan({
      name: 'agent',
      spanType: SpanType.AGENT,
      inputs: {},
    });

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.type).toBe('span_end');
    expect(queue.items[0]?.data).toEqual(span);
  });

  test('should not emit non-agent spans immediately', () => {
    tracer.startSpan({
      name: 'llm',
      spanType: SpanType.LLM,
      inputs: {},
    });

    expect(queue.items).toHaveLength(0);
  });

  test('derives parent span from SpanContext', async () => {
    const parent = tracer.startSpan({ name: 'parent', spanType: SpanType.AGENT, inputs: {} });

    await SpanContext.runAsync(parent, async () => {
      const child = tracer.startSpan({ name: 'child', spanType: SpanType.LLM, inputs: {} });
      expect(child.parentSpanId).toBe(parent.spanId);
      expect(child.traceId).toBe(parent.traceId);
    });
  });

  test('should complete span with outputs', () => {
    const span = tracer.startSpan({
      name: 'test',
      spanType: SpanType.LLM,
      inputs: {},
    });

    tracer.endSpan(span, {
      outputs: { response: 'Hello!' },
    });

    expect(span.status).toBe(SpanStatus.SUCCESS);
    expect(span.outputs).toEqual({ response: 'Hello!' });
    expect(span.endTime).toBeDefined();
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.type).toBe('span_end');
    expect(queue.items[0]?.data).toEqual(span);
  });

  test('should handle errors', () => {
    const span = tracer.startSpan({
      name: 'test',
      spanType: SpanType.LLM,
      inputs: {},
    });

    const error = new Error('Test error');
    tracer.endSpan(span, { error });

    expect(span.status).toBe(SpanStatus.ERROR);
    expect(span.error).toBeDefined();
    expect(span.error?.errorType).toBe('Error');
    expect(span.error?.message).toBe('Test error');
    expect(span.error?.stacktrace).toBeDefined();
  });

  test('should use finishSpan for agent spans', () => {
    const span = tracer.startSpan({
      name: 'agent',
      spanType: SpanType.AGENT,
      inputs: {},
    });

    tracer.endSpan(span);

    expect(queue.items).toHaveLength(2);
    expect(queue.items[1]?.type).toBe('span_finish');
    expect(queue.items[1]?.data).toEqual({ spanId: span.spanId, endTime: span.endTime });
  });

  test('should handle token usage', () => {
    const span = tracer.startSpan({
      name: 'llm',
      spanType: SpanType.LLM,
      inputs: {},
    });

    tracer.endSpan(span, {
      tokenUsage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    });

    expect(span.tokenUsage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  test('should include metadata and tags', () => {
    const span = tracer.startSpan({
      name: 'test',
      spanType: SpanType.LLM,
      inputs: {},
      metadata: { foo: 'bar' },
      tags: ['test', 'example'],
    });

    expect(span.metadata).toEqual({ foo: 'bar' });
    expect(span.tags).toEqual(['test', 'example']);
  });

  describe('PFID integration', () => {
    test('should generate valid PFID span IDs', () => {
      const span = tracer.startSpan({
        name: 'test_span',
        spanType: SpanType.LLM,
        inputs: {},
      });

      // Both span_id and trace_id should be valid PFIDs
      expect(isPfid(span.spanId)).toBe(true);
      expect(isPfid(span.traceId)).toBe(true);
    });

    test('should use provided partition for ID generation', () => {
      const partition: Partition = 12345;
      const tracerWithPartition = new Tracer(queue, partition);

      const span = tracerWithPartition.startSpan({
        name: 'test_span',
        spanType: SpanType.LLM,
        inputs: {},
      });

      // Verify IDs use the correct partition
      expect(extractPartition(span.spanId)).toBe(partition);
      expect(extractPartition(span.traceId)).toBe(partition);
    });

    test('should generate partition when none provided', () => {
      const tracerWithoutPartition = new Tracer(queue);

      const span = tracerWithoutPartition.startSpan({
        name: 'test_span',
        spanType: SpanType.LLM,
        inputs: {},
      });

      // IDs should still be valid PFIDs
      expect(isPfid(span.spanId)).toBe(true);
      expect(isPfid(span.traceId)).toBe(true);

      // Extract partition should work (returns a number)
      const partition = extractPartition(span.spanId);
      expect(typeof partition).toBe('number');
    });

    test('should use same partition for all spans from same tracer', () => {
      const partition: Partition = 99999;
      const tracerWithPartition = new Tracer(queue, partition);

      const spans: Span[] = [];
      for (let i = 0; i < 5; i++) {
        const span = tracerWithPartition.startSpan({
          name: `span_${i}`,
          spanType: SpanType.LLM,
          inputs: {},
        });
        spans.push(span);
      }

      // All spans should use the same partition
      for (const span of spans) {
        expect(extractPartition(span.spanId)).toBe(partition);
      }
    });
  });
});
