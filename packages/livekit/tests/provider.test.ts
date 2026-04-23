import { afterEach, describe, expect, test } from 'bun:test';
import { getClient, init as initCore } from '@prefactor/core';
import { DEFAULT_LIVEKIT_AGENT_SCHEMA, PrefactorLiveKit } from '../src/index.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from '../src/version.js';

class FakeSession {
  on(): void {}
  off(): void {}
}

describe('PrefactorLiveKit', () => {
  afterEach(async () => {
    await getClient()?.shutdown();
  });

  test('getDefaultAgentSchema returns default livekit schema', () => {
    const provider = new PrefactorLiveKit();
    expect(provider.getDefaultAgentSchema()).toEqual(DEFAULT_LIVEKIT_AGENT_SCHEMA);
  });

  test('getSdkHeaderEntry returns package name and version', () => {
    const provider = new PrefactorLiveKit();
    expect(provider.getSdkHeaderEntry()).toBe(`${PACKAGE_NAME}@${PACKAGE_VERSION}`);
  });

  test('normalizeAgentSchema extracts tool span types', () => {
    const provider = new PrefactorLiveKit();
    const normalized = provider.normalizeAgentSchema({
      ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
      toolSchemas: {
        lookupWeather: {
          spanType: 'lookup-weather',
          inputSchema: { type: 'object' },
        },
      },
    });

    const spanSchemas = normalized.span_schemas as Record<string, unknown>;
    expect(spanSchemas).toHaveProperty('livekit:tool:lookup-weather');
  });

  test('createMiddleware returns createSessionTracer helper', () => {
    const provider = new PrefactorLiveKit();
    const middleware = provider.createMiddleware(
      {
        startSpan: () => {
          throw new Error('not used');
        },
        endSpan: () => {},
        close: async () => {},
        startAgentInstance: () => {},
        finishAgentInstance: () => {},
      } as never,
      {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
      {
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'test-token',
          agentIdentifier: 'livekit-test',
        },
      } as never
    );

    const tracer = middleware.createSessionTracer();
    expect(typeof middleware.createSessionTracer).toBe('function');
    expect(tracer).toBeDefined();
  });

  test('middleware snapshots tool span mappings when created', async () => {
    const provider = new PrefactorLiveKit();
    provider.normalizeAgentSchema({
      ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
      toolSchemas: {
        lookupWeather: {
          spanType: 'lookup-weather',
          inputSchema: { type: 'object' },
        },
      },
    });

    const started: Array<Record<string, unknown>> = [];
    const tracer = {
      startSpan: (options: {
        inputs: Record<string, unknown>;
      }) => {
        started.push(options.inputs);
        return null;
      },
      endSpan: () => {},
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    };

    const middlewareBeforeRenormalize = provider.createMiddleware(
      tracer as never,
      {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
      {
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'test-token',
          agentIdentifier: 'livekit-test',
        },
      } as never
    );

    provider.normalizeAgentSchema({
      ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
      toolSchemas: {
        sendEmail: {
          spanType: 'send-email',
          inputSchema: { type: 'object' },
        },
      },
    });

    const middlewareAfterRenormalize = provider.createMiddleware(
      tracer as never,
      {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
      {
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'test-token',
          agentIdentifier: 'livekit-test',
        },
      } as never
    );

    await middlewareBeforeRenormalize.createSessionTracer().attach(new FakeSession() as never);
    await middlewareAfterRenormalize.createSessionTracer().attach(new FakeSession() as never);

    expect(started[0]?.metadata).toMatchObject({
      toolSpanTypes: {
        lookupWeather: 'livekit:tool:lookup-weather',
      },
    });
    expect(started[1]?.metadata).toMatchObject({
      toolSpanTypes: {
        sendEmail: 'livekit:tool:send-email',
      },
    });
  });

  test('provider shutdown closes created session tracers', async () => {
    const provider = new PrefactorLiveKit();
    const middleware = provider.createMiddleware(
      {
        startSpan: () => null,
        endSpan: () => {},
        close: async () => {},
        startAgentInstance: () => {},
        finishAgentInstance: () => {},
      } as never,
      {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
      {
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'test-token',
          agentIdentifier: 'livekit-test',
        },
      } as never
    );

    const sessionTracer = middleware.createSessionTracer();
    let closeCalls = 0;
    sessionTracer.close = async () => {
      closeCalls += 1;
    };

    await provider.shutdown();
    expect(closeCalls).toBe(1);
  });

  test('core init exposes createSessionTracer through middleware', async () => {
    const prefactor = initCore({
      provider: new PrefactorLiveKit(),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
        agentIdentifier: 'livekit-test',
      },
    });

    expect(prefactor.getMiddleware()).toHaveProperty('createSessionTracer');
  });
});
