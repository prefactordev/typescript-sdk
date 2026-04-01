import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { AgentInstanceManager } from '../src/agent/instance-manager.js';
import { getClient, init, type PrefactorProvider } from '../src/client.js';
import type { Config } from '../src/config.js';
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
    await getClient()?.shutdown();
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
