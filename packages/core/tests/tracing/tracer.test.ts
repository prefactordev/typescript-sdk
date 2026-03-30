import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { extractPartition, isPfid, type Partition } from '@prefactor/pfid';
import type { PrefactorTransportHealthState, PrefactorTransportOperation } from '../../src/errors.js';
import { SpanContext } from '../../src/tracing/context';
import { type Span, SpanStatus, SpanType } from '../../src/tracing/span';
import { Tracer } from '../../src/tracing/tracer';
import type { FinishSpanOptions, Transport } from '../../src/transport/http';

class MockTransport implements Transport {
  emitted: Span[] = [];
  finished: Array<{
    spanId: string;
    endTime: number;
    status?: string;
    resultPayload?: Record<string, unknown>;
  }> = [];
  startedInstances = 0;
  finishedInstances = 0;
  emitError: Error | null = null;
  finishSpanError: Error | null = null;
  startInstanceError: Error | null = null;
  finishInstanceError: Error | null = null;

  emit(span: Span): void {
    if (this.emitError) {
      throw this.emitError;
    }
    this.emitted.push(span);
  }

  finishSpan(spanId: string, endTime: number, options?: FinishSpanOptions): void {
    if (this.finishSpanError) {
      throw this.finishSpanError;
    }
    this.finished.push({ spanId, endTime, ...options });
  }

  startAgentInstance(): void {
    if (this.startInstanceError) {
      throw this.startInstanceError;
    }
    this.startedInstances += 1;
  }

  finishAgentInstance(): void {
    if (this.finishInstanceError) {
      throw this.finishInstanceError;
    }
    this.finishedInstances += 1;
  }

  registerSchema(_schema: Record<string, unknown>): void {}

  assertUsable(_operation: PrefactorTransportOperation): void {}

  getHealthState(): PrefactorTransportHealthState {
    return 'healthy';
  }

  async close(): Promise<void> {}
}

describe('Tracer', () => {
  let transport: MockTransport;
  let tracer: Tracer;

  beforeEach(() => {
    transport = new MockTransport();
    tracer = new Tracer(transport);
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

    expect(transport.emitted).toHaveLength(1);
    expect(transport.emitted[0]).toEqual(span);
  });

  test('swallows transport errors when emitting agent spans on start', () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    transport.emitError = new Error('transport unavailable');

    try {
      expect(() =>
        tracer.startSpan({
          name: 'agent',
          spanType: SpanType.AGENT,
          inputs: {},
        })
      ).not.toThrow();

      expect(transport.emitted).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('should not emit non-agent spans immediately', () => {
    tracer.startSpan({
      name: 'llm',
      spanType: SpanType.LLM,
      inputs: {},
    });

    expect(transport.emitted).toHaveLength(0);
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
    expect(transport.emitted).toHaveLength(1);
    expect(transport.emitted[0]).toEqual(span);
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

  test('swallows transport errors when ending spans', () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    transport.emitError = new Error('transport unavailable');
    const span = tracer.startSpan({
      name: 'test',
      spanType: SpanType.LLM,
      inputs: {},
    });
    const userError = new Error('user failure');

    try {
      expect(() => tracer.endSpan(span, { error: userError })).not.toThrow();
      expect(span.error?.message).toBe('user failure');
      expect(transport.emitted).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('should use finishSpan for agent spans', () => {
    const span = tracer.startSpan({
      name: 'agent',
      spanType: SpanType.AGENT,
      inputs: {},
    });

    tracer.endSpan(span);

    expect(transport.emitted).toHaveLength(1);
    expect(transport.finished).toHaveLength(1);
    expect(transport.finished[0]?.spanId).toBe(span.spanId);
    expect(typeof transport.finished[0]?.endTime).toBe('number');
    expect(transport.finished[0]?.status).toBe('complete');
    expect(transport.finished[0]?.resultPayload).toEqual({});
  });

  test('should include agent result payload when finished successfully', () => {
    const span = tracer.startSpan({
      name: 'agent',
      spanType: SpanType.AGENT,
      inputs: {},
    });

    tracer.endSpan(span, { outputs: { message: 'done' } });

    expect(transport.finished).toHaveLength(1);
    expect(transport.finished[0]?.status).toBe('complete');
    expect(transport.finished[0]?.resultPayload).toEqual({ message: 'done' });
  });

  test('should include error result payload when agent span fails', () => {
    const span = tracer.startSpan({
      name: 'agent',
      spanType: SpanType.AGENT,
      inputs: {},
    });

    tracer.endSpan(span, { error: new Error('boom') });

    expect(transport.finished).toHaveLength(1);
    expect(transport.finished[0]?.status).toBe('failed');
    expect(transport.finished[0]?.resultPayload).toMatchObject({
      error_type: 'Error',
      message: 'boom',
    });
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

  test('should include metadata', () => {
    const span = tracer.startSpan({
      name: 'test',
      spanType: SpanType.LLM,
      inputs: {},
      metadata: { foo: 'bar' },
    });

    expect(span.metadata).toEqual({ foo: 'bar' });
  });

  test('swallows transport errors when starting and finishing agent instances', () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    transport.startInstanceError = new Error('start failed');
    transport.finishInstanceError = new Error('finish failed');

    try {
      expect(() => tracer.startAgentInstance()).not.toThrow();
      expect(() => tracer.finishAgentInstance()).not.toThrow();
      expect(transport.startedInstances).toBe(0);
      expect(transport.finishedInstances).toBe(0);
    } finally {
      errorSpy.mockRestore();
    }
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
      const tracerWithPartition = new Tracer(transport, partition);

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
      const tracerWithoutPartition = new Tracer(transport);

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
      const tracerWithPartition = new Tracer(transport, partition);

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
