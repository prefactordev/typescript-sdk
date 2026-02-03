import { describe, expect, test } from 'bun:test';
import { SpanContext, SpanStatus, SpanType } from '@prefactor/core';
import { createInstrumentation } from '../src/instrumentation.js';

class FakeTracer {
  spans: any[] = [];
  ended: any[] = [];
  startSpan(options: any) {
    const parent = SpanContext.getCurrent();
    const span = {
      spanId: `span-${this.spans.length + 1}`,
      parentSpanId: parent?.spanId ?? null,
      traceId: parent?.traceId ?? 'trace-1',
      name: options.name,
      spanType: options.spanType,
      startTime: Date.now(),
      endTime: null,
      status: SpanStatus.RUNNING,
      inputs: options.inputs,
      outputs: null,
      tokenUsage: null,
      error: null,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
    };
    this.spans.push(span);
    return span;
  }
  endSpan(span: any, options?: any) {
    this.ended.push({ span, options });
  }
}

test('tool spans are parented to agent span and paired FIFO', () => {
  const tracer = new FakeTracer();
  const instrumentation = createInstrumentation(tracer as any, {
    transportType: 'stdio',
    sampleRate: 1,
    captureInputs: true,
    captureOutputs: true,
    maxInputLength: 100,
    maxOutputLength: 100,
  });

  instrumentation.beforeAgentStart({ agentId: 'main' }, { sessionKey: 'agent:main:main' });
  instrumentation.beforeToolCall({ toolName: 'search', params: { q: 'hi' } }, { sessionKey: 'agent:main:main' });
  instrumentation.afterToolCall({ toolName: 'search', params: { q: 'hi' }, result: { ok: true } }, { sessionKey: 'agent:main:main' });

  expect(tracer.spans.find((s) => s.spanType === SpanType.TOOL)).toBeDefined();
  const toolSpan = tracer.spans.find((s) => s.spanType === SpanType.TOOL);
  const agentSpan = tracer.spans.find((s) => s.spanType === SpanType.AGENT);
  expect(toolSpan.parentSpanId).toBe(agentSpan.spanId);
  expect(tracer.ended.length).toBeGreaterThanOrEqual(1);
});
