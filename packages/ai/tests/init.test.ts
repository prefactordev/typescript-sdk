import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SpanType } from '@prefactor/core';
import { getTracer, init, shutdown } from '../src/init';

type FetchCall = {
  url: string;
  body?: unknown;
};

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('init (HTTP schema gating)', () => {
  let originalFetch: typeof fetch;
  let fetchCalls: FetchCall[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
      fetchCalls.push({ url, body });
      return new Response(JSON.stringify({ details: { id: 'mock-id' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });

  afterEach(async () => {
    await shutdown();
    globalThis.fetch = originalFetch;
  });

  test('skipSchema is only honored for HTTP transport', async () => {
    init({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://api.prefactor.ai',
        apiToken: 'test-token',
        agentVersion: '1.0.0',
        skipSchema: true,
      },
    });

    const tracer = getTracer();
    const span = tracer.startSpan({
      name: 'agent-span',
      spanType: SpanType.AGENT,
      inputs: {},
    });
    tracer.endSpan(span);

    await waitFor(() =>
      fetchCalls.some((call) => call.url.endsWith('/api/v1/agent_instance/register'))
    );

    const registerCall = fetchCalls.find((call) =>
      call.url.endsWith('/api/v1/agent_instance/register')
    );

    expect(registerCall?.body).toBeDefined();
    expect((registerCall?.body as Record<string, unknown>).agent_schema_version).toBeUndefined();
  });

  test('agentSchemaVersion is applied for HTTP transport', async () => {
    init({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://api.prefactor.ai',
        apiToken: 'test-token',
        agentVersion: '1.0.0',
        agentSchemaVersion: 'v2.0.0',
      },
    });

    const tracer = getTracer();
    const span = tracer.startSpan({
      name: 'agent-span',
      spanType: SpanType.AGENT,
      inputs: {},
    });
    tracer.endSpan(span);

    await waitFor(() =>
      fetchCalls.some((call) => call.url.endsWith('/api/v1/agent_instance/register'))
    );

    const registerCall = fetchCalls.find((call) =>
      call.url.endsWith('/api/v1/agent_instance/register')
    );

    const schemaVersion = (registerCall?.body as Record<string, unknown>).agent_schema_version as {
      external_identifier?: string;
    };

    expect(schemaVersion?.external_identifier).toBe('v2.0.0');
  });
});
