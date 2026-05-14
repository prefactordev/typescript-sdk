import { describe, expect, test } from 'bun:test';
import {
  AgentInstanceManager,
  type PrefactorTransportHealthState,
  type PrefactorTransportOperation,
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

  assertUsable(_operation: PrefactorTransportOperation): void {}

  getHealthState(): PrefactorTransportHealthState {
    return 'healthy';
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}
}

function makeAbortedSignal(): AbortSignal {
  return AbortSignal.abort('stopped');
}

describe('PrefactorMiddleware', () => {
  test('uses existing context as parent when no root agent span is created', async () => {
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

    const llmSpan = transport.spans.find((span) => span.spanType === 'langchain:llm');

    expect(transport.spans.some((span) => span.spanType === 'langchain:agent')).toBe(false);
    expect(llmSpan?.parentSpanId).toBe(parentSpan.spanId);
    expect(llmSpan?.traceId).toBe(parentSpan.traceId);
    expect(llmSpan?.status).toBe(SpanStatus.SUCCESS);
  });

  test('emits langchain-prefixed llm and tool spans without an agent span', async () => {
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

    const llmSpan = transport.spans.find((span) => span.spanType === 'langchain:llm');
    const toolSpan = transport.spans.find((span) => span.spanType === 'langchain:tool');

    expect(transport.spans.some((span) => span.spanType === 'langchain:agent')).toBe(false);
    expect(llmSpan?.name).toBe('langchain:llm-call');
    expect(toolSpan?.name).toBe('langchain:tool-call');
  });

  test('uses configured tool span types for wrapped tools', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(tracer, agentManager, undefined, {
      get_customer_profile: 'langchain:tool:get-customer-profile',
    });

    await middleware.wrapToolCall(
      {
        toolCall: {
          name: 'get_customer_profile',
          args: { customerId: 'cust_123' },
        },
        tool: {
          name: 'get_customer_profile',
        },
      },
      async () => ({
        content: '{"id":"cust_123"}',
      })
    );

    const toolSpan = transport.spans.find(
      (span) => span.spanType === 'langchain:tool:get-customer-profile'
    );

    expect(toolSpan?.spanType).toBe('langchain:tool:get-customer-profile');
    expect(toolSpan?.inputs).toEqual({
      'langchain.tool.name': 'get_customer_profile',
      toolName: 'get_customer_profile',
      input: { customerId: 'cust_123' },
    });
    expect(toolSpan?.outputs).toEqual({ output: { id: 'cust_123' } });
    expect(transport.spans.some((span) => span.spanType === 'langchain:tool')).toBe(false);
  });

  test('normalizes failed tool outputs to null for schema compatibility', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(tracer, agentManager);

    await expect(
      middleware.wrapToolCall(
        {
          name: 'send_email',
          input: { to: 'taylor@example.com' },
        },
        async () => {
          throw new Error('boom');
        }
      )
    ).rejects.toThrow('boom');

    const toolSpan = transport.spans.find((span) => span.spanType === 'langchain:tool');

    expect(toolSpan?.outputs).toEqual({ output: null });
    expect(toolSpan?.error?.message).toBe('boom');
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

  test('does not start agent instance when beforeAgent sees an aborted run', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(
      tracer,
      agentManager,
      undefined,
      undefined,
      makeAbortedSignal
    );

    await expect(middleware.beforeAgent({ messages: [] })).rejects.toMatchObject({
      name: 'PrefactorTerminatedError',
      message: 'Agent instance terminated by p2: stopped',
    });

    expect(transport.startedInstances).toBe(0);
  });

  test('does not start agent instance when model call sees an aborted run', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(
      tracer,
      agentManager,
      undefined,
      undefined,
      makeAbortedSignal
    );

    await expect(
      middleware.wrapModelCall({ model: 'test' }, async () => ({ content: 'ok' }))
    ).rejects.toMatchObject({
      name: 'PrefactorTerminatedError',
      message: 'Agent instance terminated by p2: stopped',
    });

    expect(transport.startedInstances).toBe(0);
  });

  test('does not start agent instance when tool call sees an aborted run', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(
      tracer,
      agentManager,
      undefined,
      undefined,
      makeAbortedSignal
    );

    await expect(
      middleware.wrapToolCall({ name: 'lookup', input: { key: 'count' } }, async () => ({
        content: '42',
      }))
    ).rejects.toMatchObject({
      name: 'PrefactorTerminatedError',
      message: 'Agent instance terminated by p2: stopped',
    });

    expect(transport.startedInstances).toBe(0);
  });

  test('preserves scalar strings in tool response content without coercion', async () => {
    const transport = new CaptureTransport();
    const tracer = new Tracer(transport);
    const agentManager = new AgentInstanceManager(transport, {});
    agentManager.registerSchema({ type: 'object' });
    const middleware = new PrefactorMiddleware(tracer, agentManager);

    await middleware.wrapToolCall({ name: 'lookup', input: { key: 'count' } }, async () => ({
      content: '42',
    }));

    const toolSpan = transport.spans.find((span) => span.spanType === 'langchain:tool');
    expect(toolSpan?.outputs).toEqual({ output: '42' });
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
