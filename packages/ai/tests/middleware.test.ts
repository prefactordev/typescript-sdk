import { describe, expect, test } from 'bun:test';
import { type Span, SpanStatus, SpanType, type Tracer } from '@prefactor/core';
import { createPrefactorMiddleware } from '../src/middleware.js';

function createSpan(spanId: string, spanType: string, inputs: Record<string, unknown>): Span {
  return {
    spanId,
    parentSpanId: null,
    traceId: `trace-${spanId}`,
    name: spanId,
    spanType,
    startTime: Date.now(),
    endTime: null,
    status: SpanStatus.RUNNING,
    inputs,
    outputs: null,
    tokenUsage: null,
    error: null,
    metadata: {},
  };
}

const agentManagerStub = {
  startInstance: () => {},
  finishInstance: () => {},
} as never;

describe('ai middleware tool instrumentation', () => {
  test('captures tool execute output in tool span payload', async () => {
    const startedSpanTypes: string[] = [];
    const ended: Array<{ span: Span; options?: { outputs?: Record<string, unknown> } }> = [];

    const tracer: Tracer = {
      startSpan: (options) => {
        startedSpanTypes.push(options.spanType);
        return createSpan(`span-${startedSpanTypes.length}`, options.spanType, options.inputs);
      },
      endSpan: (span, options) => {
        ended.push({ span, options: options as { outputs?: Record<string, unknown> } });
      },
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer);
    const transformed = await (
      middleware as { transformParams?: (arg: unknown) => Promise<unknown> }
    ).transformParams?.({
      type: 'generate',
      params: {
        tools: [
          {
            name: 'get_today_date',
            execute: async () => '2026-02-11',
          },
        ],
      },
      model: {},
    });

    const result = await transformed.tools[0].execute({});

    expect(result).toBe('2026-02-11');
    expect(startedSpanTypes).toContain('ai-sdk:tool');

    const toolEnd = ended.find((entry) => entry.span.spanType === `ai-sdk:${SpanType.TOOL}`);
    expect(toolEnd?.options?.outputs).toEqual({ output: '2026-02-11' });
  });

  test('preserves array-shaped tools in transformParams', async () => {
    const tracer: Tracer = {
      startSpan: (options) => createSpan('span-tool', options.spanType, options.inputs),
      endSpan: () => {},
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer) as {
      transformParams?: (arg: {
        type: 'generate';
        params: { tools: Array<{ name: string; execute: (input: unknown) => Promise<string> }> };
        model: Record<string, unknown>;
      }) => Promise<{
        tools: Array<{ name: string; execute: (input: unknown) => Promise<string> }>;
      }>;
    };

    const transformed = await middleware.transformParams?.({
      type: 'generate',
      params: {
        tools: [
          {
            name: 'get_today_date',
            execute: async () => '2026-02-11',
          },
        ],
      },
      model: {},
    });

    expect(Array.isArray(transformed?.tools)).toBe(true);
    const value = await transformed?.tools[0]?.execute({});
    expect(value).toBe('2026-02-11');
  });

  test('uses configured tool span types for wrapped tools', async () => {
    const startedSpanTypes: string[] = [];

    const tracer: Tracer = {
      startSpan: (options) => {
        startedSpanTypes.push(options.spanType);
        return createSpan(`span-${startedSpanTypes.length}`, options.spanType, options.inputs);
      },
      endSpan: () => {},
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer, undefined, {
      agentManager: agentManagerStub,
      toolSpanTypes: {
        get_customer_profile: 'ai-sdk:tool:get-customer-profile',
      },
    }) as {
      transformParams?: (arg: unknown) => Promise<unknown>;
    };

    const transformed = await middleware.transformParams?.({
      type: 'generate',
      params: {
        tools: {
          get_customer_profile: {
            execute: async () => ({ id: 'cust_123' }),
          },
        },
      },
      model: {},
    });

    await transformed?.tools?.get_customer_profile?.execute({ customerId: 'cust_123' });

    expect(startedSpanTypes).toContain('ai-sdk:tool:get-customer-profile');
    expect(startedSpanTypes).not.toContain('ai-sdk:tool');
  });

  test('wraps object-map tools in transformParams', async () => {
    const tracer: Tracer = {
      startSpan: (options) => createSpan('span-tool', options.spanType, options.inputs),
      endSpan: () => {},
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer) as {
      transformParams?: (arg: unknown) => Promise<unknown>;
    };
    const transformed = await middleware.transformParams?.({
      type: 'generate',
      params: {
        tools: {
          get_today_date: {
            name: 'get_today_date',
            execute: async () => '2026-02-11',
          },
        },
      },
      model: {},
    });

    const value = await transformed?.tools?.get_today_date?.execute({});
    expect(value).toBe('2026-02-11');
  });

  test('does not emit empty tool spans from model tool-call parts alone', async () => {
    const startedSpanTypes: string[] = [];

    const tracer: Tracer = {
      startSpan: (options) => {
        startedSpanTypes.push(options.spanType);
        return createSpan(`span-${startedSpanTypes.length}`, options.spanType, options.inputs);
      },
      endSpan: () => {},
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer) as {
      wrapGenerate?: (arg: unknown) => Promise<unknown>;
    };
    await middleware.wrapGenerate?.({
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call',
            toolName: 'get_today_date',
            toolCallId: 'call-1',
            input: {},
          },
        ],
        finishReason: 'tool-calls',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        warnings: [],
      }),
      params: {},
      model: { provider: 'test', modelId: 'test' },
    });

    expect(startedSpanTypes).toContain('ai-sdk:llm');
    expect(startedSpanTypes).not.toContain('ai-sdk:tool');
  });

  test('emits tool span from prompt tool-result parts with output payload', async () => {
    const ended: Array<{ span: Span; options?: { outputs?: Record<string, unknown> } }> = [];

    const tracer: Tracer = {
      startSpan: (options) =>
        createSpan(`span-${options.spanType}`, options.spanType, options.inputs),
      endSpan: (span, options) => {
        ended.push({ span, options: options as { outputs?: Record<string, unknown> } });
      },
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer) as {
      wrapGenerate?: (arg: unknown) => Promise<unknown>;
    };

    await middleware.wrapGenerate?.({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'final answer' }],
        finishReason: 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        warnings: [],
      }),
      params: {
        prompt: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolName: 'get_today_date',
                toolCallId: 'call-1',
                input: {},
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolName: 'get_today_date',
                toolCallId: 'call-1',
                output: { type: 'text', value: '2026-02-11' },
              },
            ],
          },
        ],
      },
      model: { provider: 'test', modelId: 'test' },
    });

    const toolEnd = ended.find((entry) => entry.span.spanType === `ai-sdk:${SpanType.TOOL}`);
    expect(toolEnd?.options?.outputs).toEqual({ output: '2026-02-11' });
  });

  test('uses configured tool span types for prompt-derived tool spans', async () => {
    const startedSpanTypes: string[] = [];

    const tracer: Tracer = {
      startSpan: (options) => {
        startedSpanTypes.push(options.spanType);
        return createSpan(`span-${startedSpanTypes.length}`, options.spanType, options.inputs);
      },
      endSpan: () => {},
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer, undefined, {
      agentManager: agentManagerStub,
      toolSpanTypes: {
        get_customer_profile: 'ai-sdk:tool:get-customer-profile',
      },
    }) as {
      wrapGenerate?: (arg: unknown) => Promise<unknown>;
    };

    await middleware.wrapGenerate?.({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'done' }],
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        warnings: [],
      }),
      params: {
        prompt: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolName: 'get_customer_profile',
                toolCallId: 'call-1',
                input: { customerId: 'cust_123' },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolName: 'get_customer_profile',
                toolCallId: 'call-1',
                output: { type: 'text', value: '{"id":"cust_123"}' },
              },
            ],
          },
        ],
      },
      model: { provider: 'test', modelId: 'test' },
    });

    expect(startedSpanTypes).toContain('ai-sdk:tool:get-customer-profile');
    expect(startedSpanTypes).not.toContain('ai-sdk:tool');
  });

  test('does not duplicate prompt-derived spans after local tool execution', async () => {
    const startedSpanTypes: string[] = [];

    const tracer: Tracer = {
      startSpan: (options) => {
        startedSpanTypes.push(options.spanType);
        return createSpan(`span-${startedSpanTypes.length}`, options.spanType, options.inputs);
      },
      endSpan: () => {},
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer) as {
      transformParams?: (arg: unknown) => Promise<unknown>;
      wrapGenerate?: (arg: unknown) => Promise<unknown>;
    };

    const transformed = await middleware.transformParams?.({
      type: 'generate',
      params: {
        tools: {
          get_today_date: {
            execute: async () => '2026-02-11',
          },
        },
        prompt: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolName: 'get_today_date',
                toolCallId: 'call-1',
                input: {},
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolName: 'get_today_date',
                toolCallId: 'call-1',
                output: { type: 'text', value: '2026-02-11' },
              },
            ],
          },
        ],
      },
      model: {},
    });

    await middleware.wrapGenerate?.({
      doGenerate: async () => {
        await transformed?.tools?.get_today_date?.execute({}, { toolCallId: 'call-1' });
        return {
          content: [{ type: 'text', text: 'done' }],
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          warnings: [],
        };
      },
      params: transformed,
      model: { provider: 'test', modelId: 'test' },
    });

    expect(startedSpanTypes.filter((spanType) => spanType === 'ai-sdk:tool')).toHaveLength(1);
  });

  test('normalizes failed tool outputs to null for schema compatibility', async () => {
    const ended: Array<{
      span: Span;
      options?: { outputs?: Record<string, unknown>; error?: Error };
    }> = [];

    const tracer: Tracer = {
      startSpan: (options) =>
        createSpan(`span-${options.spanType}`, options.spanType, options.inputs),
      endSpan: (span, options) => {
        ended.push({
          span,
          options: options as { outputs?: Record<string, unknown>; error?: Error },
        });
      },
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer) as {
      transformParams?: (arg: unknown) => Promise<unknown>;
    };

    const transformed = await middleware.transformParams?.({
      type: 'generate',
      params: {
        tools: {
          send_email: {
            execute: async () => {
              throw new Error('boom');
            },
          },
        },
      },
      model: {},
    });

    await expect(transformed?.tools?.send_email?.execute({})).rejects.toThrow('boom');

    const toolEnd = ended.find((entry) => entry.span.spanType === `ai-sdk:${SpanType.TOOL}`);
    expect(toolEnd?.options?.outputs).toEqual({ output: null });
    expect(toolEnd?.options?.error?.message).toBe('boom');
  });

  test('does not suppress same toolCallId across separate requests', async () => {
    const ended: Array<{ span: Span; options?: { outputs?: Record<string, unknown> } }> = [];

    const tracer: Tracer = {
      startSpan: (options) =>
        createSpan(`span-${options.spanType}`, options.spanType, options.inputs),
      endSpan: (span, options) => {
        ended.push({ span, options: options as { outputs?: Record<string, unknown> } });
      },
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const middleware = createPrefactorMiddleware(tracer) as {
      wrapGenerate?: (arg: unknown) => Promise<unknown>;
    };

    const request = {
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'final answer' }],
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        warnings: [],
      }),
      params: {
        prompt: [
          {
            role: 'assistant',
            content: [
              { type: 'tool-call', toolName: 'get_today_date', toolCallId: 'call-1', input: {} },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolName: 'get_today_date',
                toolCallId: 'call-1',
                output: { type: 'text', value: '2026-02-11' },
              },
            ],
          },
        ],
      },
      model: { provider: 'test', modelId: 'test' },
    };

    await middleware.wrapGenerate?.(request);
    await middleware.wrapGenerate?.(request);

    const toolEnds = ended.filter((entry) => entry.span.spanType === `ai-sdk:${SpanType.TOOL}`);
    expect(toolEnds).toHaveLength(2);
  });
});
