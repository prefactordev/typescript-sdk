import { describe, expect, test } from 'bun:test';
import type { HttpClientError } from '@prefactor/core';
import { PrefactorAgentSpanClient, type PrefactorAgentSpanClientConfig } from '../src/index.js';

const baseConfig: PrefactorAgentSpanClientConfig = {
  apiUrl: 'https://prefactor.example',
  apiToken: 'token',
  agentId: 'agent-1',
  environmentId: 'env-1',
  agentVersion: {
    externalIdentifier: 'copilot-poc',
    name: 'VS Code Copilot OTel PoC',
    description: 'Proof-of-concept receiver for VS Code Copilot Chat OpenTelemetry traces',
  },
  requestTimeoutMs: 1000,
};

type RequestCall = {
  url: string;
  path: string;
  body: Record<string, unknown>;
  sdkHeader: string | null;
};

function createClient(fetchFn: typeof fetch) {
  return new PrefactorAgentSpanClient(baseConfig, { fetchFn });
}

describe('PrefactorAgentSpanClient', () => {
  test('registers and starts one configured agent instance', async () => {
    const calls: RequestCall[] = [];
    const client = createClient(async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({
        url: String(url),
        path: parsed.pathname,
        body: JSON.parse(String(init?.body)),
        sdkHeader: new Headers(init?.headers).get('x-prefactor-sdk'),
      });
      return Response.json({ details: { id: 'instance-1' } });
    });

    const id = await client.registerAndStartInstance({
      type: 'object',
      span_type_schemas: [],
    });

    expect(id).toBe('instance-1');
    expect(calls).toHaveLength(2);
    expect(calls[0].path).toBe('/api/v1/agent_instance/register');
    expect(calls[0].body).toMatchObject({
      agent_id: 'agent-1',
      environment_id: 'env-1',
      agent_version: {
        external_identifier: 'copilot-poc',
        name: 'VS Code Copilot OTel PoC',
        description: 'Proof-of-concept receiver for VS Code Copilot Chat OpenTelemetry traces',
      },
      agent_schema_version: {
        type: 'object',
        span_type_schemas: [],
      },
    });
    expect(calls[0].sdkHeader).toContain('@prefactor/agent-spans@0.1.0');
    expect(calls[0].sdkHeader).toContain('prefactor/core@');
    expect(calls[1].path).toBe('/api/v1/agent_instance/instance-1/start');
  });

  test('creates spans with mapped parent backend ids', async () => {
    const calls: RequestCall[] = [];
    let nextId = 1;
    const client = createClient(async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({
        url: String(url),
        path: parsed.pathname,
        body: JSON.parse(String(init?.body)),
        sdkHeader: new Headers(init?.headers).get('x-prefactor-sdk'),
      });
      return Response.json({ details: { id: `backend-${nextId++}` } });
    });

    await client.createSpan('instance-1', {
      externalSpanId: 'root',
      parentExternalSpanId: null,
      schemaName: 'copilot:invoke_agent',
      status: 'complete',
      startedAt: '2026-06-17T00:00:00.000Z',
      finishedAt: '2026-06-17T00:00:01.000Z',
      payload: { name: 'root' },
      resultPayload: {},
    });
    const childId = await client.createSpan('instance-1', {
      externalSpanId: 'child',
      parentExternalSpanId: 'root',
      schemaName: 'copilot:chat',
      status: 'complete',
      startedAt: '2026-06-17T00:00:00.100Z',
      finishedAt: '2026-06-17T00:00:00.900Z',
      payload: { name: 'child' },
      resultPayload: {},
    });

    expect(childId).toBe('backend-2');
    expect(calls[0].path).toBe('/api/v1/agent_spans');
    expect(calls[0].body).toMatchObject({
      details: {
        agent_instance_id: 'instance-1',
        parent_span_id: null,
        schema_name: 'copilot:invoke_agent',
        status: 'complete',
        started_at: '2026-06-17T00:00:00.000Z',
        finished_at: '2026-06-17T00:00:01.000Z',
        payload: { name: 'root' },
        result_payload: {},
      },
    });
    expect(calls[1].body).toMatchObject({
      details: {
        parent_span_id: 'backend-1',
        schema_name: 'copilot:chat',
      },
    });
  });

  test('throws when register response omits details id', async () => {
    const client = createClient(async () => Response.json({ details: {} }));

    await expect(client.registerAndStartInstance({ type: 'object' })).rejects.toThrow(
      'Prefactor register response did not include details.id'
    );
  });

  test('throws when create response omits details id', async () => {
    const client = createClient(async () => Response.json({ details: {} }));

    await expect(
      client.createSpan('instance-1', {
        externalSpanId: 'span-1',
        parentExternalSpanId: null,
        schemaName: 'copilot:chat',
        status: 'complete',
        startedAt: '2026-06-17T00:00:00.000Z',
        finishedAt: '2026-06-17T00:00:01.000Z',
        payload: { name: 'chat' },
        resultPayload: {},
      })
    ).rejects.toThrow('Prefactor span create response did not include details.id');
  });

  test('propagates core HTTP errors when span creation fails', async () => {
    const client = createClient(async () =>
      Response.json({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' })
    );

    await expect(
      client.createSpan('instance-1', {
        externalSpanId: 'span-1',
        parentExternalSpanId: null,
        schemaName: 'copilot:chat',
        status: 'complete',
        startedAt: '2026-06-17T00:00:00.000Z',
        finishedAt: '2026-06-17T00:00:01.000Z',
        payload: { name: 'chat' },
        resultPayload: {},
      })
    ).rejects.toMatchObject({
      name: 'HttpClientError',
      status: 403,
      responseBody: { error: 'forbidden' },
    } satisfies Partial<HttpClientError>);
  });
});
