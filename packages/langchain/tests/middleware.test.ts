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
  startedInstances = 0;
  finishedInstances = 0;

  emit(span: Span): void {
    this.spans.push(span);
  }

  finishSpan(_spanId: string, _endTime: number): void {}

  startAgentInstance(): void {
    this.startedInstances += 1;
  }

  finishAgentInstance(): void {
    this.finishedInstances += 1;
  }

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

    const agentSpan = transport.spans.find((span) => span.spanType === 'langchain:agent');
    const llmSpan = transport.spans.find((span) => span.spanType === 'langchain:llm');

    expect(agentSpan?.parentSpanId).toBe(parentSpan.spanId);
    expect(agentSpan?.traceId).toBe(parentSpan.traceId);
    expect(llmSpan?.parentSpanId).toBe(agentSpan?.spanId);
    expect(llmSpan?.traceId).toBe(agentSpan?.traceId);
    expect(llmSpan?.status).toBe(SpanStatus.SUCCESS);
  });

  test('uses langchain-prefixed operation names for emitted spans', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(tracer, agentManager);

    await middleware.beforeAgent({ messages: [{ type: 'human', content: 'hello' }] });
    await middleware.wrapModelCall(
      {
        model: {
          id: ['langchain', 'chat_models', 'ConfigurableModel'],
        },
        messages: [{ type: 'human', content: 'question' }],
      },
      async () => ({ content: 'answer' })
    );
    await middleware.wrapToolCall(
      {
        name: 'calculator',
        input: { expression: '42*17' },
      },
      async () => ({ output: '714' })
    );
    await middleware.afterAgent({ messages: [{ type: 'ai', content: 'done' }] });

    const agentSpan = transport.spans.find((span) => span.spanType === 'langchain:agent');
    const llmSpan = transport.spans.find((span) => span.spanType === 'langchain:llm');
    const toolSpan = transport.spans.find((span) => span.spanType === 'langchain:tool');

    expect(agentSpan?.name).toBe('langchain:agent');
    expect(llmSpan?.name).toBe('langchain:llm-call');
    expect(toolSpan?.name).toBe('langchain:tool-call');
  });

  test('starts and finishes agent instance even when before/after hooks are skipped', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(tracer, agentManager);

    await middleware.wrapModelCall(
      { model: 'test', messages: [{ role: 'human', content: 'hello' }] },
      async () => ({ content: 'ok' })
    );

    expect(transport.startedInstances).toBe(1);

    middleware.shutdown();

    expect(transport.finishedInstances).toBe(1);
  });

  test('uses one agent instance across multiple runs and finishes on shutdown', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(tracer, agentManager);

    await middleware.beforeAgent({ messages: [{ role: 'human', content: 'first' }] });
    await middleware.wrapModelCall({ model: 'test' }, async () => ({ content: 'one' }));
    await middleware.afterAgent({ messages: [{ role: 'ai', content: 'one' }] });

    await middleware.beforeAgent({ messages: [{ role: 'human', content: 'second' }] });
    await middleware.wrapModelCall({ model: 'test' }, async () => ({ content: 'two' }));
    await middleware.afterAgent({ messages: [{ role: 'ai', content: 'two' }] });

    expect(transport.startedInstances).toBe(1);
    expect(transport.finishedInstances).toBe(0);

    middleware.shutdown();

    expect(transport.finishedInstances).toBe(1);
  });
});
