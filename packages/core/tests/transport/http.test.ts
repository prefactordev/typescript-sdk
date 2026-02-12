import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type Span, SpanStatus, SpanType } from '../../src/tracing/span.js';
import { HttpTransport } from '../../src/transport/http.js';

const createConfig = () => ({
  apiUrl: 'https://example.com',
  apiToken: 'test-token',
  agentIdentifier: '1.0.0',
  requestTimeout: 1000,
  maxRetries: 0,
  initialRetryDelay: 1,
  maxRetryDelay: 1,
  retryMultiplier: 1,
  retryOnStatusCodes: [429, 500, 502, 503, 504],
});

describe('HttpTransport', () => {
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

  test('applies schema registration before start instance', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    transport.registerSchema({ type: 'object' });
    transport.startAgentInstance({ agentId: 'agent-123', agentName: 'Test Agent' });
    await transport.close();

    const registerPayload = JSON.parse(fetchCalls[0]?.options?.body as string) as Record<
      string,
      unknown
    >;
    expect(registerPayload.agent_id).toBe('agent-123');
    expect(registerPayload.agent_schema_version).toEqual({ type: 'object' });
  });

  test('buffers span finish until span emit maps backend id', async () => {
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
    };

    transport.finishSpan('span-1', endTime, {
      status: 'complete',
      resultPayload: { result: 'ok' },
    });
    transport.emit(span);
    await transport.close();

    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://example.com/api/v1/agent_instance/register',
      'https://example.com/api/v1/agent_spans',
      'https://example.com/api/v1/agent_spans/backend-span-1/finish',
    ]);

    const createCall = fetchCalls[1];
    const createPayload = JSON.parse(String(createCall?.options?.body)) as {
      details: Record<string, unknown>;
    };
    expect(createPayload.details.result_payload).toEqual({ result: 'ok' });

    const finishCall = fetchCalls[2];
    const finishPayload = JSON.parse(String(finishCall?.options?.body)) as Record<string, unknown>;
    expect(finishPayload).toEqual({
      timestamp: '2023-11-14T22:13:20.000Z',
      status: 'complete',
      result_payload: { result: 'ok' },
    });
  });

  test('buffers child span emission until parent backend id is available', async () => {
    const spanPayloads: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);

      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans')) {
        const payload = JSON.parse(String(options?.body)) as { details: Record<string, unknown> };
        spanPayloads.push(payload.details);

        const spanPayload = payload.details.payload as Record<string, unknown>;
        const sdkSpanId = String(spanPayload.span_id);
        const backendId = sdkSpanId === 'parent-span' ? 'backend-parent' : 'backend-child';

        return new Response(JSON.stringify({ details: { id: backendId } }), {
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

    const parentSpan: Span = {
      spanId: 'parent-span',
      parentSpanId: null,
      traceId: 'trace-1',
      name: 'Parent',
      spanType: SpanType.CHAIN,
      startTime: 1,
      endTime: 2,
      status: SpanStatus.SUCCESS,
      inputs: {},
      outputs: {},
      tokenUsage: null,
      error: null,
      metadata: {},
    };

    const childSpan: Span = {
      spanId: 'child-span',
      parentSpanId: 'parent-span',
      traceId: 'trace-1',
      name: 'Child',
      spanType: SpanType.LLM,
      startTime: 1,
      endTime: 2,
      status: SpanStatus.SUCCESS,
      inputs: {},
      outputs: {},
      tokenUsage: null,
      error: null,
      metadata: {},
    };

    transport.emit(childSpan);
    transport.emit(parentSpan);
    await transport.close();

    expect(spanPayloads).toHaveLength(2);
    expect((spanPayloads[0]?.payload as Record<string, unknown>).span_id).toBe('parent-span');
    expect((spanPayloads[1]?.payload as Record<string, unknown>).span_id).toBe('child-span');
    expect(spanPayloads[1]?.parent_span_id).toBe('backend-parent');
  });

  test('sends start and finish agent lifecycle calls', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
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
    transport.startAgentInstance();
    transport.finishAgentInstance();
    await transport.close();

    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://example.com/api/v1/agent_instance/register',
      'https://example.com/api/v1/agent_instance/agent-instance-1/start',
      'https://example.com/api/v1/agent_instance/agent-instance-1/finish',
    ]);
  });

  test('requires new agent identifier after schema changes', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      if (String(url).endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
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
    transport.registerSchema({ type: 'object' });
    transport.startAgentInstance({ agentIdentifier: 'v1.0.0' });
    transport.registerSchema({ type: 'object', properties: { name: { type: 'string' } } });
    transport.startAgentInstance({ agentIdentifier: 'v1.0.0' });
    transport.startAgentInstance({ agentIdentifier: 'v1.1.0' });
    await transport.close();

    const startCalls = fetchCalls.filter((call) =>
      call.url.includes('/agent_instance/agent-instance-1/start')
    );
    expect(startCalls).toHaveLength(2);
  });

  test('does not send default schema when no schema is configured', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    transport.startAgentInstance();
    await transport.close();

    const registerPayload = JSON.parse(fetchCalls[0]?.options?.body as string) as Record<
      string,
      unknown
    >;
    expect(registerPayload.agent_schema_version).toBeUndefined();
  });
});
