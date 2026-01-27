import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { HttpTransport } from '../../src/transport/http.js';
import type { QueueAction } from '../../src/queue/actions.js';
import { SpanStatus, SpanType, type Span } from '../../src/tracing/span.js';

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
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('updates config and starts agent instance directly', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const transport = new HttpTransport(createConfig());
    const actions: QueueAction[] = [
      {
        type: 'schema_register',
        data: {
          schemaName: 'prefactor:agent',
          schemaVersion: '2.0.0',
          schema: { type: 'object' },
        },
      },
      {
        type: 'agent_start',
        data: {
          agentId: 'agent-123',
          agentVersion: '2.0.0',
          agentName: 'Test Agent',
          agentDescription: 'Test description',
          schemaName: 'prefactor:agent',
          schemaVersion: '2.0.0',
        },
      },
    ];

    await transport.processBatch(actions);

    const config = (transport as any).config as ReturnType<typeof createConfig> & {
      agentId?: string;
      agentVersion?: string;
      agentName?: string;
      agentDescription?: string;
      agentSchema?: Record<string, unknown>;
      agentSchemaVersion?: string;
      schemaName?: string;
      schemaVersion?: string;
    };

    expect(config.agentId).toBe('agent-123');
    expect(config.agentVersion).toBe('2.0.0');
    expect(config.agentName).toBe('Test Agent');
    expect(config.agentDescription).toBe('Test description');
    expect(config.agentSchema).toEqual({ type: 'object' });
    expect(config.agentSchemaVersion).toBe('2.0.0');
    expect(config.schemaName).toBe('prefactor:agent');
    expect(config.schemaVersion).toBe('2.0.0');
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

  test('sends span end and finish directly in batch order', async () => {
    const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = async (url, options) => {
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
    };

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
      { type: 'span_end', data: span },
      { type: 'span_finish', data: { spanId: 'span-1', endTime } },
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
});
