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

test('agent start/end creates AGENT span', () => {
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
  instrumentation.agentEnd({ status: 'ok' }, { sessionKey: 'agent:main:main' });

  expect(tracer.spans[0].spanType).toBe(SpanType.AGENT);
  expect(tracer.ended.length).toBe(1);
});
