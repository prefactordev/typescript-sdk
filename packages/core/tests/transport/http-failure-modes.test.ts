import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PrefactorFatalError } from '../../src/errors.js';
import { type Span, SpanStatus, SpanType } from '../../src/tracing/span.js';
import { HttpTransport } from '../../src/transport/http.js';

const createConfig = () => ({
  apiUrl: 'https://example.com',
  apiToken: 'test-token',
  agentIdentifier: '1.0.0',
  requestTimeout: 10,
  maxRetries: 0,
  initialRetryDelay: 1,
  maxRetryDelay: 1,
  retryMultiplier: 1,
  retryOnStatusCodes: [429, 500, 502, 503, 504],
});

function createSpan(spanId: string, parentSpanId: string | null = null): Span {
  return {
    spanId,
    parentSpanId,
    traceId: `trace-${spanId}`,
    name: spanId,
    spanType: SpanType.LLM,
    startTime: Date.now(),
    endTime: Date.now(),
    status: SpanStatus.SUCCESS,
    inputs: { prompt: 'hello' },
    outputs: { result: 'ok' },
    tokenUsage: null,
    error: null,
    metadata: {},
  };
}

async function waitForQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error('Condition was not met in time');
}

describe('HttpTransport failure modes', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('enters fatal auth state, invokes callback once, and rethrows the same error later', async () => {
    const fatalErrors: PrefactorFatalError[] = [];

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'bad token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig(), {
      failureHandling: {
        onFatalError: (error) => {
          fatalErrors.push(error);
        },
      },
    });

    transport.startAgentInstance();
    await waitForQueue();

    expect(fatalErrors).toHaveLength(1);
    expect(fatalErrors[0]?.kind).toBe('auth');

    let thrownError: unknown;
    try {
      transport.startAgentInstance();
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBe(fatalErrors[0]);
    await transport.close();
  });

  test('enters fatal contract state on 422 span create rejection', async () => {
    const fatalErrors: PrefactorFatalError[] = [];

    globalThis.fetch = (async (url) => {
      if (String(url).endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'invalid schema payload' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig(), {
      failureHandling: {
        onFatalError: (error) => {
          fatalErrors.push(error);
        },
      },
    });

    transport.emit(createSpan('span-1'));
    await waitForQueue();

    expect(fatalErrors).toHaveLength(1);
    expect(fatalErrors[0]?.kind).toBe('contract');

    let thrownError: unknown;
    try {
      transport.emit(createSpan('span-2'));
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBe(fatalErrors[0]);
    await transport.close();
  });

  test('retries agent-not-found registration with the same idempotency key', async () => {
    const registerBodies: Array<Record<string, unknown>> = [];
    let registerAttempts = 0;

    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);
      if (urlString.endsWith('/agent_instance/register')) {
        registerAttempts += 1;
        registerBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);

        if (registerAttempts === 1) {
          return new Response(JSON.stringify({ code: 'not_found', message: 'agent not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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
    await waitForQueue();

    expect(registerBodies).toHaveLength(2);
    expect(registerBodies[0]?.idempotency_key).toBe(registerBodies[1]?.idempotency_key);
    expect(transport.getHealthState()).toBe('healthy');

    await transport.close();
  });

  test('retries exhausted network failures with the same idempotency key', async () => {
    const registerBodies: Array<Record<string, unknown>> = [];
    let registerAttempts = 0;

    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);
      if (urlString.endsWith('/agent_instance/register')) {
        registerAttempts += 1;
        registerBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);

        if (registerAttempts === 1) {
          const timeoutError = new Error('timed out');
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }

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
    await waitForQueue();

    expect(registerBodies).toHaveLength(2);
    expect(registerBodies[0]?.idempotency_key).toBe(registerBodies[1]?.idempotency_key);
    expect(transport.getHealthState()).toBe('healthy');

    await transport.close();
  });

  test('retries 429 agent start failures with the same idempotency key', async () => {
    const startBodies: Array<Record<string, unknown>> = [];
    let startAttempts = 0;

    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);
      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_instance/agent-instance-1/start')) {
        startAttempts += 1;
        startBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);

        if (startAttempts === 1) {
          return new Response(JSON.stringify({ error: 'rate limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    transport.startAgentInstance();
    await waitForQueue();

    expect(startBodies).toHaveLength(2);
    expect(startBodies[0]?.idempotency_key).toBe(startBodies[1]?.idempotency_key);
    expect(transport.getHealthState()).toBe('healthy');

    await transport.close();
  });

  test('retries 503 agent start failures with the same idempotency key', async () => {
    const startBodies: Array<Record<string, unknown>> = [];
    let startAttempts = 0;

    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);
      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_instance/agent-instance-1/start')) {
        startAttempts += 1;
        startBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);

        if (startAttempts === 1) {
          return new Response(JSON.stringify({ error: 'backend unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    transport.startAgentInstance();
    await waitForQueue();

    expect(startBodies).toHaveLength(2);
    expect(startBodies[0]?.idempotency_key).toBe(startBodies[1]?.idempotency_key);
    expect(transport.getHealthState()).toBe('healthy');

    await transport.close();
  });

  test('drops stale retried agent starts after a schema revision change', async () => {
    const registerBodies: Array<Record<string, unknown>> = [];
    const startBodies: Array<Record<string, unknown>> = [];
    let startAttempts = 0;

    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);
      if (urlString.endsWith('/agent_instance/register')) {
        registerBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);

        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_instance/agent-instance-1/start')) {
        startAttempts += 1;
        startBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);

        if (startAttempts === 1) {
          return new Response(JSON.stringify({ error: 'backend unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport({
      ...createConfig(),
      initialRetryDelay: 50,
      maxRetryDelay: 50,
    });

    transport.registerSchema({ type: 'object' });
    transport.startAgentInstance({ agentIdentifier: 'v1.0.0' });
    await waitFor(() => startAttempts === 1);

    const updatedSchema = { type: 'object', properties: { name: { type: 'string' } } };
    transport.registerSchema(updatedSchema);
    transport.startAgentInstance({ agentIdentifier: 'v1.1.0' });
    await waitFor(() => startBodies.length === 2);
    await waitForQueue();

    expect(registerBodies).toHaveLength(2);
    expect(registerBodies[0]?.agent_schema_version).toEqual({ type: 'object' });
    expect(registerBodies[0]?.agent_version).toEqual({
      external_identifier: 'v1.0.0',
      name: 'Agent',
      description: '',
    });
    expect(registerBodies[1]?.agent_schema_version).toEqual(updatedSchema);
    expect(registerBodies[1]?.agent_version).toEqual({
      external_identifier: 'v1.1.0',
      name: 'Agent',
      description: '',
    });
    expect(startBodies).toHaveLength(2);
    expect(startBodies[0]?.idempotency_key).not.toBe(startBodies[1]?.idempotency_key);
    expect(transport.getHealthState()).toBe('healthy');

    await transport.close();
  });

  test('rejects shutdown when a pending span finish never receives a backend id', async () => {
    const transport = new HttpTransport(createConfig());

    transport.finishSpan('missing-span', Date.now(), {
      status: 'complete',
      resultPayload: { ok: true },
    });
    await waitForQueue();

    await expect(transport.close()).rejects.toMatchObject({
      kind: 'partial_telemetry',
    });
  });

  test('rejects shutdown when child span references remain unresolved', async () => {
    globalThis.fetch = (async (url) => {
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

    transport.emit(createSpan('child-span', 'parent-span'));
    await waitForQueue();

    await expect(transport.close()).rejects.toMatchObject({
      kind: 'partial_telemetry',
    });
  });

  test('rejects shutdown when close races with new work', async () => {
    let releaseRegister: (() => void) | null = null;

    globalThis.fetch = (((url) => {
      if (String(url).endsWith('/agent_instance/register')) {
        return new Promise<Response>((resolve) => {
          releaseRegister = () => {
            resolve(
              new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            );
          };
        });
      }

      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }) as unknown) as typeof fetch;

    const transport = new HttpTransport(createConfig());
    transport.startAgentInstance();
    await waitFor(() => releaseRegister !== null);
    const closePromise = transport.close();

    expect(() => transport.emit(createSpan('late-span'))).toThrow(PrefactorFatalError);
    releaseRegister?.();

    await expect(closePromise).rejects.toMatchObject({
      kind: 'dropped_on_shutdown',
    });
  });

  test('treats missing backend span ids as partial telemetry, not fatal app failure', async () => {
    globalThis.fetch = (async (url) => {
      if (String(url).endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ details: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    transport.emit(createSpan('span-missing-id'));
    await waitForQueue();

    await expect(transport.close()).rejects.toMatchObject({
      kind: 'partial_telemetry',
    });
  });
});
