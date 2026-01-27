import { describe, expect, test } from 'bun:test';
import {
  AgentInstanceManager,
  SpanContext,
  SpanStatus,
  SpanType,
  Tracer,
  type Queue,
  type QueueAction,
  type Span,
} from '@prefactor/core';
import { PrefactorMiddleware } from '../src/middleware.js';

class CaptureQueue implements Queue<QueueAction> {
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

describe('PrefactorMiddleware', () => {
  test('uses context parent for root span and nests child spans', async () => {
    const queue = new CaptureQueue();
    const tracer = new Tracer(queue);
    const agentManager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });
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

    const agentSpan = queue.items.find(
      (item): item is { type: 'span_end'; data: Span } =>
        item.type === 'span_end' && item.data.spanType === SpanType.AGENT
    )?.data;
    const llmSpan = queue.items.find(
      (item): item is { type: 'span_end'; data: Span } =>
        item.type === 'span_end' && item.data.spanType === SpanType.LLM
    )?.data;

    expect(agentSpan?.parentSpanId).toBe(parentSpan.spanId);
    expect(agentSpan?.traceId).toBe(parentSpan.traceId);
    expect(llmSpan?.parentSpanId).toBe(agentSpan?.spanId);
    expect(llmSpan?.traceId).toBe(agentSpan?.traceId);
    expect(llmSpan?.status).toBe(SpanStatus.SUCCESS);
  });
});
