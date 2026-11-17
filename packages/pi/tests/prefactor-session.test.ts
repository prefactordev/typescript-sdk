import { describe, expect, test } from 'bun:test';
import type { HttpRequester, HttpRequestOptions } from '@prefactor/core';
import { PrefactorSession, type PrefactorSessionOptions } from '../src/prefactor-session.js';

type RecordedRequest = { path: string; body: Record<string, unknown> | undefined };

class FakeRequester implements HttpRequester {
  readonly requests: RecordedRequest[] = [];
  private nextId = 0;

  constructor(
    private readonly failPaths: RegExp[] = [],
    private readonly hangPaths: RegExp[] = []
  ) {}

  async request<TResponse>(path: string, options: HttpRequestOptions = {}): Promise<TResponse> {
    // Yield so later calls can be queued before this one answers, as with real network requests.
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.requests.push({ path, body: options.body as Record<string, unknown> | undefined });
    if (this.hangPaths.some((pattern) => pattern.test(path))) {
      return new Promise<TResponse>(() => undefined);
    }
    if (this.failPaths.some((pattern) => pattern.test(path))) {
      throw new Error(`failed ${path}`);
    }
    if (path === '/api/v1/ping') {
      return { details: { agent_id: 'agent-from-ping' } } as TResponse;
    }
    this.nextId += 1;
    return { details: { id: `id-${this.nextId}` } } as TResponse;
  }
}

const OPTIONS: PrefactorSessionOptions = {
  apiUrl: 'https://prefactor.example',
  apiToken: 'token',
  agentId: 'agent-1',
  agentVersion: { external_identifier: '1.5.2', name: 'pi', description: 'pi' },
  agentSchemaVersion: { external_identifier: 'schema', span_type_schemas: [] },
  sdkHeaderEntry: '@prefactor/pi@0.0.0',
};

function details(request: RecordedRequest): Record<string, unknown> {
  return request.body?.details as Record<string, unknown>;
}

describe('PrefactorSession', () => {
  test('sends requests in call order, so parents are created before and finished after children', async () => {
    const requester = new FakeRequester();
    const session = new PrefactorSession(OPTIONS, requester);

    const parent = session.startSpan({ schemaName: 'pi:session', payload: {} });
    const child = session.startSpan({ schemaName: 'pi:agent_run', payload: {}, parent });
    session.recordSpan({
      schemaName: 'pi:llm',
      payload: {},
      parent: child,
      status: 'complete',
      resultPayload: { content: [] },
      startedAt: 1_000,
      finishedAt: 2_000,
    });
    session.finishSpan(child, 'complete', { response: 'ok' });
    session.finishSpan(parent, 'complete', { reason: 'quit' });
    await session.finish();

    expect(requester.requests.map((request) => request.path)).toEqual([
      '/api/v1/agent_instance/register',
      '/api/v1/agent_instance/id-1/start',
      '/api/v1/agent_spans',
      '/api/v1/agent_spans',
      '/api/v1/agent_spans',
      '/api/v1/agent_spans/id-4/finish',
      '/api/v1/agent_spans/id-3/finish',
      '/api/v1/agent_instance/id-1/finish',
    ]);
    expect(details(requester.requests[3])).toMatchObject({
      agent_instance_id: 'id-1',
      schema_name: 'pi:agent_run',
      status: 'active',
      parent_span_id: 'id-3',
    });
    expect(details(requester.requests[4])).toMatchObject({
      schema_name: 'pi:llm',
      status: 'complete',
      parent_span_id: 'id-4',
      result_payload: { content: [] },
      started_at: new Date(1_000).toISOString(),
      finished_at: new Date(2_000).toISOString(),
    });
  });

  test('never sends a finish time earlier than the span start', async () => {
    const requester = new FakeRequester();
    const session = new PrefactorSession(OPTIONS, requester);

    const span = session.startSpan({ schemaName: 'pi:session', payload: {}, startedAt: 2_000 });
    session.finishSpan(span, 'complete', {}, 1_500);
    const later = session.startSpan({ schemaName: 'pi:session', payload: {}, startedAt: 2_000 });
    session.finishSpan(later, 'complete', {}, 2_500);
    await session.flush();

    const finishes = requester.requests.filter((request) => request.path.endsWith('/finish'));
    expect(finishes.map((request) => request.body?.timestamp)).toEqual([
      new Date(2_000).toISOString(),
      new Date(2_500).toISOString(),
    ]);
  });

  test('reads the agent id from ping when none is given', async () => {
    const requester = new FakeRequester();
    const session = new PrefactorSession({ ...OPTIONS, agentId: undefined }, requester);
    await session.flush();

    expect(requester.requests[0].path).toBe('/api/v1/ping');
    expect(requester.requests[1].body).toMatchObject({ agent_id: 'agent-from-ping' });
  });

  test('reports the first failure once and skips spans that depend on it', async () => {
    const requester = new FakeRequester([/^\/api\/v1\/agent_spans$/]);
    const errors: unknown[] = [];
    const session = new PrefactorSession(
      { ...OPTIONS, onError: (error) => errors.push(error) },
      requester
    );

    const parent = session.startSpan({ schemaName: 'pi:session', payload: {} });
    session.startSpan({ schemaName: 'pi:agent_run', payload: {}, parent });
    session.finishSpan(parent, 'complete', {});
    await session.finish();

    expect(errors).toHaveLength(1);
    expect(session.getLastError()).toBeNull();
    expect(requester.requests.map((request) => request.path)).toEqual([
      '/api/v1/agent_instance/register',
      '/api/v1/agent_instance/id-1/start',
      '/api/v1/agent_spans',
      '/api/v1/agent_instance/id-1/finish',
    ]);
  });

  test('keeps sending requests when the onError callback throws', async () => {
    const requester = new FakeRequester([/^\/api\/v1\/agent_spans$/]);
    const session = new PrefactorSession(
      {
        ...OPTIONS,
        onError: () => {
          throw new Error('stale context');
        },
      },
      requester
    );

    session.startSpan({ schemaName: 'pi:session', payload: {} });
    session.recordSpan({
      schemaName: 'pi:llm',
      payload: {},
      status: 'complete',
      resultPayload: {},
      startedAt: 1,
      finishedAt: 2,
    });
    await session.finish();

    expect(requester.requests.map((request) => request.path)).toEqual([
      '/api/v1/agent_instance/register',
      '/api/v1/agent_instance/id-1/start',
      '/api/v1/agent_spans',
      '/api/v1/agent_spans',
      '/api/v1/agent_instance/id-1/finish',
    ]);
  });

  test('keeps the registration failure when later operations send no request', async () => {
    const requester = new FakeRequester([/register$/]);
    const session = new PrefactorSession(OPTIONS, requester);

    const parent = session.startSpan({ schemaName: 'pi:session', payload: {} });
    session.finishSpan(parent, 'complete', {});
    await session.flush();

    expect(session.getLastError()).toBeInstanceOf(Error);
    expect(requester.requests).toHaveLength(1);
  });

  test('stops waiting at shutdown after the timeout', async () => {
    const requester = new FakeRequester([], [/^\/api\/v1\/agent_spans$/]);
    const session = new PrefactorSession({ ...OPTIONS, shutdownTimeoutMs: 50 }, requester);
    session.startSpan({ schemaName: 'pi:session', payload: {} });

    const started = Date.now();
    await session.finish();

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(requester.requests.map((request) => request.path)).not.toContain(
      '/api/v1/agent_instance/id-1/finish'
    );
  });
});
