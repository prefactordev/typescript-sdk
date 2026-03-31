import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PrefactorFatalError } from '../../src/errors.js';
import { type Span, SpanStatus, SpanType } from '../../src/tracing/span.js';
import { HttpTransport } from '../../src/transport/http.js';

type TestTransportConfig = ConstructorParameters<typeof HttpTransport>[0];

function createConfig(overrides: Partial<TestTransportConfig> = {}): TestTransportConfig {
  return {
    apiUrl: 'https://example.com',
    apiToken: 'test-token',
    agentIdentifier: '1.0.0',
    requestTimeout: 10,
    maxRetries: 0,
    initialRetryDelay: 1,
    maxRetryDelay: 1,
    retryMultiplier: 1,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
    ...overrides,
  };
}

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

    const transport = new HttpTransport(createConfig({ maxRetries: 1 }));
    transport.startAgentInstance();
    await waitForQueue();

    expect(registerBodies).toHaveLength(2);
    expect(registerBodies[0]?.idempotency_key).toBe(registerBodies[1]?.idempotency_key);
    expect(transport.getHealthState()).toBe('healthy');

    await transport.close();
  });

  test('retries transient network failures with the same idempotency key', async () => {
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

    const transport = new HttpTransport(createConfig({ maxRetries: 1 }));
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

    const transport = new HttpTransport(createConfig({ maxRetries: 1 }));
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

    const transport = new HttpTransport(createConfig({ maxRetries: 1 }));
    transport.startAgentInstance();
    await waitForQueue();

    expect(startBodies).toHaveLength(2);
    expect(startBodies[0]?.idempotency_key).toBe(startBodies[1]?.idempotency_key);
    expect(transport.getHealthState()).toBe('healthy');

    await transport.close();
  });

  test('enters fatal retry_exhausted state after permanent transient failures', async () => {
    const fatalErrors: PrefactorFatalError[] = [];
    let registerAttempts = 0;

    globalThis.fetch = (async (url) => {
      if (String(url).endsWith('/agent_instance/register')) {
        registerAttempts += 1;
        return new Response(JSON.stringify({ error: 'backend unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
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

    transport.startAgentInstance();
    await waitForQueue();

    expect(registerAttempts).toBe(1);
    expect(fatalErrors).toHaveLength(1);
    expect(fatalErrors[0]?.kind).toBe('retry_exhausted');
    expect(fatalErrors[0]?.operation).toBe('agent_start');
    expect(fatalErrors[0]?.responseBody).toEqual({
      transientKind: 'backend_transient',
      retryAttempt: 0,
      responseBody: { error: 'backend unavailable' },
    });

    let thrownError: unknown;
    try {
      transport.startAgentInstance();
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBe(fatalErrors[0]);
    await transport.close();
  });

  test('retries deferred span finishes without reissuing span create', async () => {
    const createBodies: Array<Record<string, unknown>> = [];
    const finishBodies: Array<Record<string, unknown>> = [];
    let finishAttempts = 0;

    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);

      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans')) {
        createBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);

        return new Response(JSON.stringify({ details: { id: 'backend-span-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans/backend-span-1/finish')) {
        finishAttempts += 1;
        finishBodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);

        if (finishAttempts === 1) {
          return new Response(JSON.stringify({ error: 'temporary unavailable' }), {
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

    const transport = new HttpTransport(createConfig({ maxRetries: 1 }));
    const span = createSpan('deferred-finish-span');

    transport.finishSpan(span.spanId, span.endTime ?? Date.now(), {
      status: 'complete',
      resultPayload: { ok: true },
    });
    transport.emit(span);
    await waitFor(() => finishBodies.length === 2);

    expect(createBodies).toHaveLength(1);
    expect(finishBodies).toHaveLength(2);
    expect(finishBodies[0]?.idempotency_key).toBe(finishBodies[1]?.idempotency_key);

    await transport.close();
  });

  test('enters fatal retry_exhausted when a deferred span finish keeps failing', async () => {
    const fatalErrors: PrefactorFatalError[] = [];
    let createAttempts = 0;
    let finishAttempts = 0;

    globalThis.fetch = (async (url) => {
      const urlString = String(url);

      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans')) {
        createAttempts += 1;
        return new Response(JSON.stringify({ details: { id: 'backend-span-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans/backend-span-1/finish')) {
        finishAttempts += 1;
        return new Response(JSON.stringify({ error: 'temporary unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig({ maxRetries: 1 }), {
      failureHandling: {
        onFatalError: (error) => {
          fatalErrors.push(error);
        },
      },
    });
    const span = createSpan('deferred-finish-fatal');

    transport.finishSpan(span.spanId, span.endTime ?? Date.now(), {
      status: 'complete',
      resultPayload: { ok: true },
    });
    transport.emit(span);
    await waitFor(() => fatalErrors.length === 1);

    expect(createAttempts).toBe(1);
    expect(finishAttempts).toBe(2);
    expect(fatalErrors[0]?.kind).toBe('retry_exhausted');
    expect(fatalErrors[0]?.operation).toBe('span_finish');

    await transport.close();
  });

  test('retries queued child span creates without reissuing the parent span', async () => {
    const parentBodies: Array<Record<string, unknown>> = [];
    const childBodies: Array<Record<string, unknown>> = [];
    let childAttempts = 0;

    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);

      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans')) {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        const details = body.details as Record<string, unknown>;
        const payload = details.payload as Record<string, unknown>;
        const spanId = String(payload.span_id);

        if (spanId === 'parent-span') {
          parentBodies.push(body);
          return new Response(JSON.stringify({ details: { id: 'backend-parent' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        childAttempts += 1;
        childBodies.push(body);
        if (childAttempts === 1) {
          return new Response(JSON.stringify({ error: 'temporary unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ details: { id: 'backend-child' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig({ maxRetries: 1 }));

    transport.emit(createSpan('child-span', 'parent-span'));
    transport.emit(createSpan('parent-span'));
    await waitFor(() => childBodies.length === 2);

    expect(parentBodies).toHaveLength(1);
    expect(childBodies).toHaveLength(2);
    expect(childBodies[0]?.idempotency_key).toBe(childBodies[1]?.idempotency_key);
    expect((childBodies[1]?.details as Record<string, unknown>)?.parent_span_id).toBe(
      'backend-parent'
    );

    await transport.close();
  });

  test('enters fatal retry_exhausted when a queued child span keeps failing', async () => {
    const fatalErrors: PrefactorFatalError[] = [];
    let parentAttempts = 0;
    let childAttempts = 0;

    globalThis.fetch = (async (url, options) => {
      const urlString = String(url);

      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_spans')) {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        const details = body.details as Record<string, unknown>;
        const payload = details.payload as Record<string, unknown>;
        const spanId = String(payload.span_id);

        if (spanId === 'parent-span') {
          parentAttempts += 1;
          return new Response(JSON.stringify({ details: { id: 'backend-parent' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        childAttempts += 1;
        return new Response(JSON.stringify({ error: 'temporary unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig({ maxRetries: 1 }), {
      failureHandling: {
        onFatalError: (error) => {
          fatalErrors.push(error);
        },
      },
    });

    transport.emit(createSpan('child-span', 'parent-span'));
    transport.emit(createSpan('parent-span'));
    await waitFor(() => fatalErrors.length === 1);

    expect(parentAttempts).toBe(1);
    expect(childAttempts).toBe(2);
    expect(fatalErrors[0]?.kind).toBe('retry_exhausted');
    expect(fatalErrors[0]?.operation).toBe('span_create');

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
      maxRetries: 1,
      initialRetryDelay: 50,
      maxRetryDelay: 50,
    });

    transport.registerSchema({ type: 'object' });
    transport.startAgentInstance({ agentIdentifier: 'v1.0.0' });
    await waitFor(() => startAttempts === 2);

    const updatedSchema = { type: 'object', properties: { name: { type: 'string' } } };
    transport.registerSchema(updatedSchema);
    transport.startAgentInstance({ agentIdentifier: 'v1.1.0' });
    await waitFor(() => startBodies.length === 3);
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
    expect(startBodies).toHaveLength(3);
    expect(startBodies[0]?.idempotency_key).toBe(startBodies[1]?.idempotency_key);
    expect(startBodies[0]?.idempotency_key).not.toBe(startBodies[2]?.idempotency_key);
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

    globalThis.fetch = ((url) => {
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
    }) as unknown as typeof fetch;

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
