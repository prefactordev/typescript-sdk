import { beforeEach, describe, expect, test } from 'bun:test';
import { extractPartition, isPfid, type Partition } from '@prefactor/pfid';
import { z } from 'zod';
import {
  defineSpanType,
  registerSpanType,
  registerSpanTypeWithSchema,
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

  describe('Schema validation', () => {
    test('should validate inputs against registered schema on startSpan', () => {
      const schema = z.object({
        url: z.string().url(),
        method: z.enum(['GET', 'POST']),
      });

      const API_FETCH = registerSpanTypeWithSchema('api:fetch', { input: schema });

      // Valid input - should not log error
      const span = tracer.startSpan({
        name: 'fetch',
        spanType: API_FETCH,
        inputs: { url: 'https://api.example.com/data', method: 'GET' },
      });

      expect(span.spanType).toBe(API_FETCH);
    });

    test('should log error for invalid inputs', () => {
      const schema = z.object({
        url: z.string().url(),
        method: z.enum(['GET', 'POST']),
      });

      const API_FETCH = registerSpanTypeWithSchema('api:fetch:invalid', { input: schema });

      // Capture console.error
      const originalError = console.error;
      const errorMessages: string[] = [];
      console.error = (...args) => {
        errorMessages.push(args.join(' '));
      };

      // Invalid input - missing method
      const span = tracer.startSpan({
        name: 'fetch',
        spanType: API_FETCH,
        inputs: { url: 'https://api.example.com/data' },
      });

      // Should have logged validation error
      expect(errorMessages.length).toBeGreaterThan(0);
      expect(errorMessages[0]).toContain('Span input validation failed');

      // Span should still be created
      expect(span.spanType).toBe(API_FETCH);

      console.error = originalError;
    });

    test('should validate outputs against registered schema on endSpan', () => {
      const inputSchema = z.object({
        query: z.string(),
      });

      const outputSchema = z.object({
        results: z.array(z.string()),
        count: z.number(),
      });

      const DB_QUERY = registerSpanTypeWithSchema('db:query', {
        input: inputSchema,
        output: outputSchema,
      });

      const span = tracer.startSpan({
        name: 'query',
        spanType: DB_QUERY,
        inputs: { query: 'SELECT * FROM users' },
      });

      // Valid output - should not log error
      tracer.endSpan(span, {
        outputs: { results: ['user1', 'user2'], count: 2 },
      });

      expect(span.status).toBe(SpanStatus.SUCCESS);
      expect(span.outputs).toEqual({ results: ['user1', 'user2'], count: 2 });
    });

    test('should log error for invalid outputs', () => {
      const outputSchema = z.object({
        results: z.array(z.string()),
        count: z.number(),
      });

      const DB_QUERY = registerSpanTypeWithSchema('db:query:invalid', { output: outputSchema });

      const span = tracer.startSpan({
        name: 'query',
        spanType: DB_QUERY,
        inputs: {},
      });

      // Capture console.error
      const originalError = console.error;
      const errorMessages: string[] = [];
      console.error = (...args) => {
        errorMessages.push(args.join(' '));
      };

      // Invalid output - missing count
      tracer.endSpan(span, {
        outputs: { results: ['user1', 'user2'] },
      });

      // Should have logged validation error
      expect(errorMessages.length).toBeGreaterThan(0);
      expect(errorMessages[0]).toContain('Span output validation failed');

      // Span should still be finished
      expect(span.status).toBe(SpanStatus.SUCCESS);

      console.error = originalError;
    });

    test('should not validate when validation is disabled', () => {
      const schema = z.object({
        requiredField: z.string(),
      });

      const MY_TYPE = registerSpanTypeWithSchema('my:type', { input: schema });

      const tracerNoValidation = new Tracer(transport, { validateSchemas: false });

      // Capture console.error
      const originalError = console.error;
      const errorMessages: string[] = [];
      console.error = (...args) => {
        errorMessages.push(args.join(' '));
      };

      // Invalid input - missing required field
      const span = tracerNoValidation.startSpan({
        name: 'test',
        spanType: MY_TYPE,
        inputs: {}, // Missing requiredField
      });

      // Should NOT have logged validation error (validation disabled)
      expect(errorMessages).toHaveLength(0);
      expect(span.spanType).toBe(MY_TYPE);

      console.error = originalError;
    });

    test('should skip output validation on error', () => {
      const schema = z.object({
        correctField: z.string(),
      });

      const MY_TYPE = registerSpanTypeWithSchema('my:error:type', { output: schema });

      const span = tracer.startSpan({
        name: 'test',
        spanType: MY_TYPE,
        inputs: {},
      });

      // Capture console.error
      const originalError = console.error;
      const errorMessages: string[] = [];
      console.error = (...args) => {
        errorMessages.push(args.join(' '));
      };

      // End span with error - output validation should be skipped
      tracer.endSpan(span, {
        error: new Error('Something went wrong'),
        outputs: {}, // Invalid data, but should not be validated on error
      });

      // Should NOT have output validation errors (validation skipped on error)
      const outputErrors = errorMessages.filter((msg) => msg.includes('output validation failed'));
      expect(outputErrors).toHaveLength(0);

      expect(span.status).toBe(SpanStatus.ERROR);
      expect(span.error?.message).toBe('Something went wrong');

      console.error = originalError;
    });

    test('should work with span types without schemas', () => {
      const NO_SCHEMA_TYPE = defineSpanType('no:schema');

      const span = tracer.startSpan({
        name: 'test',
        spanType: NO_SCHEMA_TYPE,
        inputs: { any: 'data' },
      });

      tracer.endSpan(span, {
        outputs: { any: 'result' },
      });

      expect(span.status).toBe(SpanStatus.SUCCESS);
      expect(span.outputs).toEqual({ any: 'result' });
    });

    test('should validate only when schema is provided for phase', () => {
      const inputSchema = z.object({
        input: z.string(),
      });

      const TYPE_INPUT_ONLY = registerSpanTypeWithSchema('type:input-only', { input: inputSchema });

      const span = tracer.startSpan({
        name: 'test',
        spanType: TYPE_INPUT_ONLY,
        inputs: { input: 'valid' },
      });

      // No output schema - should not validate outputs
      tracer.endSpan(span, {
        outputs: { invalid: 'data' },
      });

      expect(span.status).toBe(SpanStatus.SUCCESS);
      expect(span.outputs).toEqual({ invalid: 'data' });
    });
  });
});
