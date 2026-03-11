import { describe, expect, test } from 'bun:test';
import { AgentInstanceClient } from '../../src/transport/http/agent-instance-client.js';
import { AgentSpanClient } from '../../src/transport/http/agent-span-client.js';
import type { HttpRequestOptions } from '../../src/transport/http/http-client.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type RequestCall = {
  path: string;
  options: HttpRequestOptions;
};

describe('HTTP endpoint clients', () => {
  test('agent instance client posts register, start, and finish to expected endpoints', async () => {
    const calls: RequestCall[] = [];
    const httpClient = {
      request: async <TResponse>(path: string, options: HttpRequestOptions = {}) => {
        calls.push({ path, options });
        return { details: { id: 'agent-instance-1' } } as TResponse;
      },
    };

    const client = new AgentInstanceClient(httpClient);

    await client.register({
      agent_id: 'agent-123',
      agent_version: {
        external_identifier: 'v1.0.0',
        name: 'Test Agent',
        description: 'test',
      },
      agent_schema_version: { type: 'object' },
    });
    await client.start('agent-instance-1');
    await client.finish('agent-instance-1');

    expect(calls[0].path).toBe('/api/v1/agent_instance/register');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.body).toMatchObject({
      agent_id: 'agent-123',
      agent_version: { external_identifier: 'v1.0.0', name: 'Test Agent', description: 'test' },
      agent_schema_version: { type: 'object' },
    });
    expect((calls[0].options.body as Record<string, unknown>).idempotency_key).toMatch(
      UUID_V4_REGEX
    );

    expect(calls[1].path).toBe('/api/v1/agent_instance/agent-instance-1/start');
    expect(calls[1].options.method).toBe('POST');
    expect((calls[1].options.body as Record<string, unknown>).idempotency_key).toMatch(
      UUID_V4_REGEX
    );

    expect(calls[2].path).toBe('/api/v1/agent_instance/agent-instance-1/finish');
    expect(calls[2].options.method).toBe('POST');
    expect((calls[2].options.body as Record<string, unknown>).idempotency_key).toMatch(
      UUID_V4_REGEX
    );
  });

  test('agent span client posts create and finish to expected endpoints', async () => {
    const calls: RequestCall[] = [];
    const httpClient = {
      request: async <TResponse>(path: string, options: HttpRequestOptions = {}) => {
        calls.push({ path, options });
        return { details: { id: 'backend-span-1' } } as TResponse;
      },
    };

    const client = new AgentSpanClient(httpClient);

    await client.create({
      details: {
        agent_instance_id: 'agent-instance-1',
        schema_name: 'llm',
        status: 'complete',
        payload: {
          span_id: 'span-1',
          trace_id: 'trace-1',
          name: 'Span 1',
          status: 'complete',
          inputs: { prompt: 'hello' },
          outputs: { text: 'world' },
          metadata: {},
          token_usage: null,
          error: null,
        },
        parent_span_id: null,
        started_at: '2026-02-09T00:00:00.000Z',
        finished_at: '2026-02-09T00:00:01.000Z',
      },
    });

    await client.finish('backend-span-1', '2026-02-09T00:00:01.000Z', {
      status: 'complete',
      result_payload: { text: 'world' },
    });

    expect(calls[0].path).toBe('/api/v1/agent_spans');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.body).toMatchObject({
      details: {
        agent_instance_id: 'agent-instance-1',
        schema_name: 'llm',
        status: 'complete',
        parent_span_id: null,
        started_at: '2026-02-09T00:00:00.000Z',
        finished_at: '2026-02-09T00:00:01.000Z',
      },
    });
    expect((calls[0].options.body as Record<string, unknown>).idempotency_key).toMatch(
      UUID_V4_REGEX
    );

    expect(calls[1].path).toBe('/api/v1/agent_spans/backend-span-1/finish');
    expect(calls[1].options.method).toBe('POST');
    expect(calls[1].options.body).toMatchObject({
      timestamp: '2026-02-09T00:00:01.000Z',
      status: 'complete',
      result_payload: { text: 'world' },
    });
    expect((calls[1].options.body as Record<string, unknown>).idempotency_key).toMatch(
      UUID_V4_REGEX
    );
  });
});

describe('Idempotency key validation', () => {
  const makeHttpClient = () => {
    const calls: RequestCall[] = [];
    const httpClient = {
      request: async <TResponse>(path: string, options: HttpRequestOptions = {}) => {
        calls.push({ path, options });
        return { details: { id: 'test-id' } } as TResponse;
      },
    };
    return { calls, httpClient };
  };

  const validKey = 'my-custom-key-123';
  const tooLongKey = 'a'.repeat(65);

  describe('AgentInstanceClient', () => {
    test('register: auto-generates UUID when no idempotency_key provided', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentInstanceClient(httpClient);
      await client.register({});
      const key = (calls[0].options.body as Record<string, unknown>).idempotency_key;
      expect(key).toMatch(UUID_V4_REGEX);
      expect((key as string).length).toBeLessThanOrEqual(64);
    });

    test('register: passes through valid key unchanged', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentInstanceClient(httpClient);
      await client.register({ idempotency_key: validKey });
      expect((calls[0].options.body as Record<string, unknown>).idempotency_key).toBe(validKey);
    });

    test('register: throws for key > 64 chars', async () => {
      const { httpClient } = makeHttpClient();
      const client = new AgentInstanceClient(httpClient);
      expect(() => client.register({ idempotency_key: tooLongKey })).toThrow(
        /idempotency_key must be ≤64 characters/
      );
    });

    test('start: auto-generates UUID when no idempotency_key provided', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentInstanceClient(httpClient);
      await client.start('inst-1');
      const key = (calls[0].options.body as Record<string, unknown>).idempotency_key;
      expect(key).toMatch(UUID_V4_REGEX);
    });

    test('start: passes through valid key unchanged', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentInstanceClient(httpClient);
      await client.start('inst-1', { idempotency_key: validKey });
      expect((calls[0].options.body as Record<string, unknown>).idempotency_key).toBe(validKey);
    });

    test('start: throws for key > 64 chars', async () => {
      const { httpClient } = makeHttpClient();
      const client = new AgentInstanceClient(httpClient);
      expect(() => client.start('inst-1', { idempotency_key: tooLongKey })).toThrow(
        /idempotency_key must be ≤64 characters/
      );
    });

    test('finish: auto-generates UUID when no idempotency_key provided', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentInstanceClient(httpClient);
      await client.finish('inst-1');
      const key = (calls[0].options.body as Record<string, unknown>).idempotency_key;
      expect(key).toMatch(UUID_V4_REGEX);
    });

    test('finish: passes through valid key unchanged', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentInstanceClient(httpClient);
      await client.finish('inst-1', { idempotency_key: validKey });
      expect((calls[0].options.body as Record<string, unknown>).idempotency_key).toBe(validKey);
    });

    test('finish: throws for key > 64 chars', async () => {
      const { httpClient } = makeHttpClient();
      const client = new AgentInstanceClient(httpClient);
      expect(() => client.finish('inst-1', { idempotency_key: tooLongKey })).toThrow(
        /idempotency_key must be ≤64 characters/
      );
    });
  });

  describe('AgentSpanClient', () => {
    const basePayload = {
      details: {
        agent_instance_id: 'inst-1',
        schema_name: 'llm',
        status: 'complete' as const,
        payload: {},
        parent_span_id: null,
        started_at: '2026-01-01T00:00:00.000Z',
        finished_at: null,
      },
    };

    test('create: auto-generates UUID when no idempotency_key provided', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentSpanClient(httpClient);
      await client.create(basePayload);
      const key = (calls[0].options.body as Record<string, unknown>).idempotency_key;
      expect(key).toMatch(UUID_V4_REGEX);
    });

    test('create: passes through valid key unchanged', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentSpanClient(httpClient);
      await client.create({ ...basePayload, idempotency_key: validKey });
      expect((calls[0].options.body as Record<string, unknown>).idempotency_key).toBe(validKey);
    });

    test('create: throws for key > 64 chars', async () => {
      const { httpClient } = makeHttpClient();
      const client = new AgentSpanClient(httpClient);
      expect(() => client.create({ ...basePayload, idempotency_key: tooLongKey })).toThrow(
        /idempotency_key must be ≤64 characters/
      );
    });

    test('finish: auto-generates UUID when no idempotency_key provided', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentSpanClient(httpClient);
      await client.finish('span-1', '2026-01-01T00:00:01.000Z');
      const key = (calls[0].options.body as Record<string, unknown>).idempotency_key;
      expect(key).toMatch(UUID_V4_REGEX);
    });

    test('finish: passes through valid key unchanged', async () => {
      const { calls, httpClient } = makeHttpClient();
      const client = new AgentSpanClient(httpClient);
      await client.finish('span-1', '2026-01-01T00:00:01.000Z', { idempotency_key: validKey });
      expect((calls[0].options.body as Record<string, unknown>).idempotency_key).toBe(validKey);
    });

    test('finish: throws for key > 64 chars', async () => {
      const { httpClient } = makeHttpClient();
      const client = new AgentSpanClient(httpClient);
      await expect(
        client.finish('span-1', '2026-01-01T00:00:01.000Z', { idempotency_key: tooLongKey })
      ).rejects.toThrow(/idempotency_key must be ≤64 characters/);
    });
  });
});
