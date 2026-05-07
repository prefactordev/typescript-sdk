import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { AgentInstanceManager } from '../src/agent/instance-manager.js';
import { getClient, init, PrefactorClient, type PrefactorProvider } from '../src/client.js';
import type { Config } from '../src/config.js';
import type { CoreRuntime } from '../src/create-core.js';
import type { Tracer } from '../src/tracing/tracer.js';

class TestProvider implements PrefactorProvider {
  constructor(
    private readonly middleware: unknown,
    private readonly onShutdown?: () => void,
    private readonly sdkHeaderEntry?: string
  ) {}

  createMiddleware(_tracer: Tracer, _agentManager: AgentInstanceManager, _config: Config): unknown {
    return this.middleware;
  }

  getSdkHeaderEntry(): string | undefined {
    return this.sdkHeaderEntry;
  }

  shutdown(): void {
    this.onShutdown?.();
  }
}

class AlternateProvider implements PrefactorProvider {
  createMiddleware(_tracer: Tracer, _agentManager: AgentInstanceManager, _config: Config): unknown {
    return { name: 'alternate' };
  }
}

describe('core client init', () => {
  afterEach(async () => {
    await getClient()
      ?.shutdown()
      .catch(() => {});
  });

  test('returns existing client for equivalent provider/config', () => {
    const first = init({
      provider: new TestProvider({ name: 'first' }),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'token',
        agentIdentifier: '1.0.0',
      },
    });

    const second = init({
      provider: new TestProvider({ name: 'second' }),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'token',
        agentIdentifier: '1.0.0',
      },
    });

    expect(second).toBe(first);
    expect(second.getMiddleware()).toEqual({ name: 'first' });
  });

  test('throws when re-initialized with different provider type', () => {
    init({
      provider: new TestProvider({ name: 'first' }),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'token',
      },
    });

    expect(() =>
      init({
        provider: new AlternateProvider(),
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'token',
        },
      })
    ).toThrow(/already initialized/i);
  });

  test('throws when re-initialized with different config', () => {
    init({
      provider: new TestProvider({ name: 'first' }),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'token',
        agentIdentifier: '1.0.0',
      },
    });

    expect(() =>
      init({
        provider: new TestProvider({ name: 'first' }),
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'token',
          agentIdentifier: '2.0.0',
        },
      })
    ).toThrow(/already initialized/i);
  });

  test('throws when re-initialized with different sdk header entries', () => {
    init({
      provider: new TestProvider({ name: 'first' }, undefined, '@prefactor/ai@0.3.1'),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'token',
        agentIdentifier: '1.0.0',
      },
    });

    expect(() =>
      init({
        provider: new TestProvider({ name: 'second' }, undefined, '@prefactor/langchain@0.3.1'),
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'token',
          agentIdentifier: '1.0.0',
        },
      })
    ).toThrow(/already initialized/i);
  });

  test('returns existing client when equivalent init recreates onFatalError callback', () => {
    const first = init({
      provider: new TestProvider({ name: 'first' }),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'token',
        agentIdentifier: '1.0.0',
      },
      failureHandling: {
        onFatalError: () => {},
      },
    });

    const second = init({
      provider: new TestProvider({ name: 'second' }),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'token',
        agentIdentifier: '1.0.0',
      },
      failureHandling: {
        onFatalError: () => {},
      },
    });

    expect(second).toBe(first);
    expect(second.getMiddleware()).toEqual({ name: 'first' });
  });

  test('keeps the first onFatalError callback for equivalent re-initialization', async () => {
    const originalFetch = globalThis.fetch;
    const firstCallback = { onFatalError: (_error: unknown) => {} };
    const secondCallback = { onFatalError: (_error: unknown) => {} };
    const firstSpy = spyOn(firstCallback, 'onFatalError');
    const secondSpy = spyOn(secondCallback, 'onFatalError');

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'bad token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

    try {
      const first = init({
        provider: new TestProvider({ name: 'first' }),
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'token',
          agentIdentifier: '1.0.0',
        },
        failureHandling: {
          onFatalError: (error) => {
            firstCallback.onFatalError(error);
          },
        },
      });

      const second = init({
        provider: new TestProvider({ name: 'second' }),
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'token',
          agentIdentifier: '1.0.0',
        },
        failureHandling: {
          onFatalError: (error) => {
            secondCallback.onFatalError(error);
          },
        },
      });

      expect(second).toBe(first);

      first.getTracer().startAgentInstance();
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(firstSpy).toHaveBeenCalledTimes(1);
      expect(secondSpy).toHaveBeenCalledTimes(0);
    } finally {
      globalThis.fetch = originalFetch;
      firstSpy.mockRestore();
      secondSpy.mockRestore();
    }
  });

  test('invokes provider shutdown when client shuts down', async () => {
    const tracker = {
      onShutdown: () => {},
    };
    const shutdownSpy = spyOn(tracker, 'onShutdown');

    const client = init({
      provider: new TestProvider({ name: 'first' }, () => tracker.onShutdown()),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'token',
      },
    });

    await client.shutdown();

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    shutdownSpy.mockRestore();
  });
});

describe('PrefactorClient finishCurrentRun', () => {
  function createFinishCurrentRunClient(
    calls: string[],
    provider: PrefactorProvider
  ): PrefactorClient {
    return new PrefactorClient(
      {
        terminationMonitor: {
          reset: () => calls.push('monitor-reset'),
        },
        agentManager: {
          getAgentInstanceId: () => {
            calls.push('get-instance-id');
            return 'instance-123';
          },
          finishInstance: () => calls.push('finish-instance'),
        },
      } as unknown as CoreRuntime,
      {},
      provider
    );
  }

  test('calls provider reset hook and resets termination monitor', () => {
    const calls: string[] = [];
    const client = createFinishCurrentRunClient(calls, {
      createMiddleware: () => ({}),
      resetForNextRun: () => calls.push('provider-reset'),
    });

    client.finishCurrentRun();

    expect(calls).toEqual(['provider-reset', 'monitor-reset']);
  });

  test('finishes active instance and resets termination monitor when provider has no reset hook', () => {
    const calls: string[] = [];
    const client = createFinishCurrentRunClient(calls, {
      createMiddleware: () => ({}),
    });

    client.finishCurrentRun();

    expect(calls).toEqual(['get-instance-id', 'finish-instance', 'monitor-reset']);
  });

  test('resets termination monitor when provider reset hook throws', () => {
    const calls: string[] = [];
    const client = createFinishCurrentRunClient(calls, {
      createMiddleware: () => ({}),
      resetForNextRun: () => {
        calls.push('provider-reset');
        throw new Error('reset failed');
      },
    });

    expect(() => client.finishCurrentRun()).toThrow('reset failed');
    expect(calls).toEqual(['provider-reset', 'monitor-reset']);
  });
});
