import { describe, expect, test } from 'bun:test';
import {
  AgentInstanceManager,
  type Span,
  SpanContext,
  SpanStatus,
  SpanType,
  Tracer,
  type Transport,
} from '@prefactor/core';
import { PrefactorMiddleware } from '../src/middleware.js';

class CaptureTransport implements Transport {
  spans: Span[] = [];

  emit(span: Span): void {
    this.spans.push(span);
  }

  finishSpan(_spanId: string, _endTime: number): void {}

  startAgentInstance(): void {}

  finishAgentInstance(): void {}

  registerSchema(_schema: Record<string, unknown>): void {}

  async flush(): Promise<void> {}

  async close(): Promise<void> {}
}

describe('PrefactorMiddleware', () => {
  test('uses context parent for root span and nests child spans', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(tracer, agentManager);

    const parentSpan = tracer.startSpan({
      name: 'external',
      spanType: SpanType.CHAIN,
      inputs: {},
    });

    await SpanContext.runAsync(parentSpan, async () => {
      await middleware.beforeAgent({ messages: ['hi'] });
      await middleware.wrapModelCall({ model: 'test' }, async () => ({ content: 'ok' }));
      await middleware.afterAgent({ messages: ['bye'] });
    });

    const agentSpan = transport.spans.find((span) => span.spanType === SpanType.AGENT);
    const llmSpan = transport.spans.find((span) => span.spanType === SpanType.LLM);

    expect(agentSpan?.parentSpanId).toBe(parentSpan.spanId);
    expect(agentSpan?.traceId).toBe(parentSpan.traceId);
    expect(llmSpan?.parentSpanId).toBe(agentSpan?.spanId);
    expect(llmSpan?.traceId).toBe(agentSpan?.traceId);
    expect(llmSpan?.status).toBe(SpanStatus.SUCCESS);
  });
});
