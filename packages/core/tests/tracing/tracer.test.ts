import { beforeEach, describe, expect, test } from 'bun:test';
import { extractPartition, isPfid, type Partition } from '@prefactor/pfid';
import {
  defineSpanType,
  registerSpanType,
  type Span,
  SpanStatus,
  SpanType,
  spanTypeRegistry,
} from '../../src/tracing/span';
import { Tracer } from '../../src/tracing/tracer';
import type { Transport } from '../../src/transport/base';

class MockTransport implements Transport {
  spans: Span[] = [];
  finishedSpans: { spanId: string; endTime: number }[] = [];

  emit(span: Span): void {
    this.spans.push(span);
  }

  finishSpan(spanId: string, endTime: number): void {
    this.finishedSpans.push({ spanId, endTime });
  }

  startAgentInstance(): void {}
  finishAgentInstance(): void {}
  close(): void {}
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

    expect(transport.spans).toHaveLength(1);
    expect(transport.spans[0].spanId).toBe(span.spanId);
  });

  test('should not emit non-agent spans immediately', () => {
    tracer.startSpan({
      name: 'llm',
      spanType: SpanType.LLM,
      inputs: {},
    });

    expect(transport.spans).toHaveLength(0);
  });

  test('should handle parent-child relationships', () => {
    const parent = tracer.startSpan({
      name: 'parent',
      spanType: SpanType.AGENT,
      inputs: {},
    });

    const child = tracer.startSpan({
      name: 'child',
      spanType: SpanType.LLM,
      inputs: {},
      parentSpanId: parent.spanId,
      traceId: parent.traceId,
    });

    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.traceId).toBe(parent.traceId);
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
    expect(transport.spans).toHaveLength(1);
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

    expect(transport.finishedSpans).toHaveLength(1);
    expect(transport.finishedSpans[0].spanId).toBe(span.spanId);
    expect(transport.finishedSpans[0].endTime).toBe(span.endTime);
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

  describe('Custom span types', () => {
    test('should work with custom span types defined via defineSpanType', () => {
      const customType = defineSpanType('custom:operation');

      const span = tracer.startSpan({
        name: 'custom_operation',
        spanType: customType,
        inputs: { test: 'data' },
      });

      expect(span.spanType).toBe(customType);
      expect(span.name).toBe('custom_operation');
      expect(span.inputs).toEqual({ test: 'data' });
    });

    test('should register custom span types in the registry', () => {
      const customType = registerSpanType('registered:type');

      expect(spanTypeRegistry.isKnown(customType)).toBe(true);
    });

    test('should detect agent-type spans with prefix convention', () => {
      const agentType = defineSpanType('agent:task');

      expect(spanTypeRegistry.isAgentSpanType(agentType)).toBe(true);
    });

    test('should detect agent-type spans with suffix convention', () => {
      const agentType = defineSpanType('workflow:agent');

      expect(spanTypeRegistry.isAgentSpanType(agentType)).toBe(true);
    });

    test('should emit agent-type custom spans immediately', () => {
      const agentType = defineSpanType('custom:agent');

      const span = tracer.startSpan({
        name: 'custom_agent',
        spanType: agentType,
        inputs: {},
      });

      expect(transport.spans).toHaveLength(1);
      expect(transport.spans[0].spanId).toBe(span.spanId);
    });

    test('should not emit non-agent custom spans immediately', () => {
      const customType = defineSpanType('custom:operation');

      tracer.startSpan({
        name: 'custom_operation',
        spanType: customType,
        inputs: {},
      });

      expect(transport.spans).toHaveLength(0);
    });

    test('should use finishSpan for custom agent-type spans', () => {
      const agentType = defineSpanType('autogen:agent');

      const span = tracer.startSpan({
        name: 'autogen_agent',
        spanType: agentType,
        inputs: {},
      });

      tracer.endSpan(span);

      expect(transport.finishedSpans).toHaveLength(1);
      expect(transport.finishedSpans[0].spanId).toBe(span.spanId);
    });
  });

  describe('SpanType registry', () => {
    test('should have all built-in types registered by default', () => {
      const allTypes = spanTypeRegistry.getAll();

      expect(allTypes).toContain(SpanType.AGENT);
      expect(allTypes).toContain(SpanType.LLM);
      expect(allTypes).toContain(SpanType.TOOL);
      expect(allTypes).toContain(SpanType.CHAIN);
      expect(allTypes).toContain(SpanType.RETRIEVER);
      expect(allTypes.length).toBeGreaterThanOrEqual(5);
    });

    test('should allow batch registration of span types', () => {
      const types = [defineSpanType('a'), defineSpanType('b'), defineSpanType('c')];

      expect(() => spanTypeRegistry.registerBatch(types)).not.toThrow();

      expect(spanTypeRegistry.isKnown(types[0] ?? SpanType.AGENT)).toBe(true);
      expect(spanTypeRegistry.isKnown(types[1] ?? SpanType.AGENT)).toBe(true);
      expect(spanTypeRegistry.isKnown(types[2] ?? SpanType.AGENT)).toBe(true);
    });

    test('should return all registered types', () => {
      const initialCount = spanTypeRegistry.getAll().length;
      const newType = registerSpanType('test:type');

      const allTypes = spanTypeRegistry.getAll();

      expect(allTypes.length).toBeGreaterThan(initialCount);
      expect(allTypes).toContain(newType);
    });
  });
});
