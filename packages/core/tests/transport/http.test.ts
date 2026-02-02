import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { QueueAction } from '../../src/queue/actions.js';
import { type Span, SpanStatus, SpanType } from '../../src/tracing/span.js';
import { HttpTransport } from '../../src/transport/http.js';

const createConfig = () => ({
  apiUrl: 'https://example.com',
  apiToken: 'test-token',
  requestTimeout: 1000,
  connectTimeout: 1000,
  maxRetries: 0,
  initialRetryDelay: 1,
  maxRetryDelay: 1,
  retryMultiplier: 1,
  skipSchema: false,
});

describe('HttpTransport processBatch', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = (async (..._args) =>
      new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('applies schema updates before starting agent instance', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    const actions: QueueAction[] = [
      {
        type: 'agent_start',
        data: {
          agentId: 'agent-123',
          agentIdentifier: '2.0.0',
          agentName: 'Test Agent',
          agentDescription: 'Test description',
          schemaName: 'prefactor:agent',
          schemaIdentifier: '2.0.0',
        },
      },
      {
        type: 'schema_register',
        data: {
          schemaName: 'prefactor:agent',
          schemaIdentifier: '2.0.0',
          schema: { type: 'object' },
        },
      },
    ];

    await transport.processBatch(actions);

    // biome-ignore lint/suspicious/noExplicitAny: <Accessing private property for test, assigning any to bypass type error.>
    const config = (transport as any).config as ReturnType<typeof createConfig> & {
      agentId?: string;
      agentIdentifier?: string;
      agentName?: string;
      agentDescription?: string;
      agentSchema?: Record<string, unknown>;
      agentSchemaIdentifier?: string;
      schemaName?: string;
      schemaIdentifier?: string;
    };

    expect(config.agentId).toBe('agent-123');
    expect(config.agentIdentifier).toBe('2.0.0');
    expect(config.agentName).toBe('Test Agent');
    expect(config.agentDescription).toBe('Test description');
    expect(config.agentSchema).toEqual({ type: 'object' });
    expect(config.agentSchemaIdentifier).toBe('2.0.0');
    expect(config.schemaName).toBe('prefactor:agent');
    expect(config.schemaIdentifier).toBe('2.0.0');
    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://example.com/api/v1/agent_instance/register',
      'https://example.com/api/v1/agent_instance/agent-instance-1/start',
    ]);

    const registerPayload = JSON.parse(fetchCalls[0]?.options?.body as string) as Record<
      string,
      unknown
    >;
    expect(registerPayload.agent_id).toBe('agent-123');
    expect(registerPayload.agent_schema_version).toEqual({ type: 'object' });

    await transport.close();
  });

  test('buffers span finish until after span end', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);
      fetchCalls.push({ url: urlString, options });

      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans')) {
        return new Response(JSON.stringify({ details: { id: 'backend-span-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    const endTime = 1700000000000;
    const span: Span = {
      spanId: 'span-1',
      parentSpanId: null,
      traceId: 'trace-1',
      name: 'Test Span',
      spanType: SpanType.LLM,
      startTime: endTime - 1000,
      endTime,
      status: SpanStatus.SUCCESS,
      inputs: { prompt: 'hi' },
      outputs: { result: 'ok' },
      tokenUsage: null,
      error: null,
      metadata: {},
      tags: [],
    };

    const actions: QueueAction[] = [
      { type: 'span_finish', data: { spanId: 'span-1', endTime } },
      { type: 'span_end', data: span },
    ];

    await transport.processBatch(actions);

    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://example.com/api/v1/agent_instance/register',
      'https://example.com/api/v1/agent_spans',
      'https://example.com/api/v1/agent_spans/backend-span-1/finish',
    ]);

    const finishPayload = JSON.parse(fetchCalls[2]?.options?.body as string) as Record<
      string,
      unknown
    >;
    expect(finishPayload.timestamp).toBe(new Date(endTime).toISOString());

    await transport.close();
  });

  test('flushes pending span finishes before agent finish', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);
      fetchCalls.push({ url: urlString, options });

      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans')) {
        return new Response(JSON.stringify({ details: { id: 'backend-span-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    const endTime = 1700000001000;
    const span: Span = {
      spanId: 'span-2',
      parentSpanId: null,
      traceId: 'trace-2',
      name: 'Agent Span',
      spanType: SpanType.AGENT,
      startTime: endTime - 500,
      endTime,
      status: SpanStatus.SUCCESS,
      inputs: { prompt: 'hi' },
      outputs: { result: 'ok' },
      tokenUsage: null,
      error: null,
      metadata: {},
      tags: [],
    };

    // Real queue order: span_end, span_finish, then agent_finish
    const actions: QueueAction[] = [
      { type: 'span_end', data: span },
      { type: 'span_finish', data: { spanId: 'span-2', endTime } },
      { type: 'agent_finish', data: {} },
    ];

    await transport.processBatch(actions);

    // span_finish is flushed before agent_finish
    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://example.com/api/v1/agent_instance/register',
      'https://example.com/api/v1/agent_spans',
      'https://example.com/api/v1/agent_spans/backend-span-1/finish',
      'https://example.com/api/v1/agent_instance/agent-instance-1/finish',
    ]);

    await transport.close();
  });

  test('handles span_finish in separate batch from span_end', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);
      fetchCalls.push({ url: urlString, options });

      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans')) {
        return new Response(JSON.stringify({ details: { id: 'backend-span-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    const endTime = 1700000000000;
    const span: Span = {
      spanId: 'span-1',
      parentSpanId: null,
      traceId: 'trace-1',
      name: 'Test Span',
      spanType: SpanType.AGENT,
      startTime: endTime - 1000,
      endTime,
      status: SpanStatus.SUCCESS,
      inputs: { prompt: 'hi' },
      outputs: { result: 'ok' },
      tokenUsage: null,
      error: null,
      metadata: {},
      tags: [],
    };

    // First batch: only span_end (simulating AGENT span start)
    const batch1: QueueAction[] = [{ type: 'span_end', data: span }];
    await transport.processBatch(batch1);

    // spanIdMap should now have the mapping
    // biome-ignore lint/suspicious/noExplicitAny: <Accessing private property for test.>
    expect((transport as any).spanIdMap.get('span-1')).toBe('backend-span-1');

    // Second batch: span_finish arrives later
    const batch2: QueueAction[] = [{ type: 'span_finish', data: { spanId: 'span-1', endTime } }];
    await transport.processBatch(batch2);

    // Should have made the finish call
    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://example.com/api/v1/agent_instance/register',
      'https://example.com/api/v1/agent_spans',
      'https://example.com/api/v1/agent_spans/backend-span-1/finish',
    ]);

    await transport.close();
  });

  test('defers span_finish when span_end arrives later', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);
      fetchCalls.push({ url: urlString, options });

      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans')) {
        return new Response(JSON.stringify({ details: { id: 'backend-span-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    const endTime = 1700000000000;
    const span: Span = {
      spanId: 'span-1',
      parentSpanId: null,
      traceId: 'trace-1',
      name: 'Test Span',
      spanType: SpanType.LLM,
      startTime: endTime - 1000,
      endTime,
      status: SpanStatus.SUCCESS,
      inputs: { prompt: 'hi' },
      outputs: { result: 'ok' },
      tokenUsage: null,
      error: null,
      metadata: {},
      tags: [],
    };

    // First batch: span_finish arrives BEFORE span_end (out of order)
    const batch1: QueueAction[] = [{ type: 'span_finish', data: { spanId: 'span-1', endTime } }];
    await transport.processBatch(batch1);

    // Should be in pending finishes
    // biome-ignore lint/suspicious/noExplicitAny: <Accessing private property for test.>
    expect((transport as any).pendingFinishes.get('span-1')).toBe(endTime);
    // No finish API call yet
    expect(fetchCalls.length).toBe(0);

    // Second batch: span_end arrives
    const batch2: QueueAction[] = [{ type: 'span_end', data: span }];
    await transport.processBatch(batch2);

    // Should have processed the pending finish
    // biome-ignore lint/suspicious/noExplicitAny: <Accessing private property for test.>
    expect((transport as any).pendingFinishes.has('span-1')).toBe(false);

    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://example.com/api/v1/agent_instance/register',
      'https://example.com/api/v1/agent_spans',
      'https://example.com/api/v1/agent_spans/backend-span-1/finish',
    ]);

    await transport.close();
  });

  test('logs warning for pending finishes on close', async () => {
    const transport = new HttpTransport(createConfig());
    const endTime = 1700000000000;

    // Add a pending finish manually (simulating span_finish before span_end)
    // biome-ignore lint/suspicious/noExplicitAny: <Accessing private property for test.>
    (transport as any).pendingFinishes.set('orphan-span', endTime);

    // Capture console.warn calls
    const warnCalls: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args.join(' '));
    };

    await transport.close();

    console.warn = originalWarn;

    expect(warnCalls.some((msg) => msg.includes('1 pending span finish'))).toBe(true);
    // biome-ignore lint/suspicious/noExplicitAny: <Accessing private property for test.>
    expect((transport as any).pendingFinishes.size).toBe(0);
  });
});
