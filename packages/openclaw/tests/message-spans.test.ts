import { expect, test } from 'bun:test';
import { SpanContext, SpanStatus, SpanType } from '@prefactor/core';
import { createInstrumentation } from '../src/instrumentation.js';

class FakeTracer {
  spans: any[] = [];
  ended: any[] = [];
  startSpan(options: any) {
    const span = {
      spanId: `span-${this.spans.length + 1}`,
      parentSpanId: null,
      traceId: 'trace-1',
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

test('message_received creates CHAIN span', () => {
  const tracer = new FakeTracer();
  const instrumentation = createInstrumentation(tracer as any, {
    transportType: 'stdio',
    sampleRate: 1,
    captureInputs: true,
    captureOutputs: true,
    maxInputLength: 100,
    maxOutputLength: 100,
  });

  instrumentation.messageReceived({ content: 'hi' }, { sessionKey: 'agent:main:main' });

  expect(tracer.spans[0].spanType).toBe(SpanType.CHAIN);
  expect(tracer.spans[0].name).toBe('openclaw:message');
});

test('message_sent creates CHAIN span', () => {
  const tracer = new FakeTracer();
  const instrumentation = createInstrumentation(tracer as any, {
    transportType: 'stdio',
    sampleRate: 1,
    captureInputs: true,
    captureOutputs: true,
    maxInputLength: 100,
    maxOutputLength: 100,
  });

  instrumentation.messageSent({ content: 'hello', to: 'user' }, { sessionKey: 'agent:main:main' });

  expect(tracer.spans.find((s) => s.inputs?.direction === 'outbound')).toBeDefined();
});
