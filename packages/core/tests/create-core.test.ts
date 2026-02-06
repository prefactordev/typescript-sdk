import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createConfig } from '../src/config.js';
import { createCore } from '../src/create-core.js';

const createWarnSpy = () => {
  const warnMessages: string[] = [];
  const warnSpy = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnMessages.push(args.map(String).join(' '));
  });

  return { warnMessages, warnSpy };
};

describe('createCore', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = (async (..._args) =>
      new Response(JSON.stringify({ details: { id: 'test-span' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('defaults agentIdentifier to v1.0.0 when omitted for HTTP transport', async () => {
    const config = createConfig({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
      },
    });

    const core = createCore(config);
    expect(core.tracer).toBeDefined();
    expect(core.agentManager).toBeDefined();
    await core.shutdown();
  });

  test('does not warn when agentSchema is provided for HTTP transport', async () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const config = createConfig({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
        agentIdentifier: '1.0.0',
        agentSchema: { type: 'object' },
      },
    });
    const core = createCore(config);

    try {
      core.agentManager.startInstance({ agentId: 'agent-1' });

      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      await core.shutdown();
    }
  });

  test('warns when schema is not registered for HTTP transport without agent schema', async () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const config = createConfig({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
      },
    });
    const core = createCore(config);

    try {
      core.agentManager.startInstance({ agentId: 'agent-1' });

      expect(warnMessages).toHaveLength(1);
      expect(warnMessages[0]).toMatch(/must be registered/);
    } finally {
      warnSpy.mockRestore();
      await core.shutdown();
    }
  });

  test('rejects stdio transport type', () => {
    expect(() =>
      createConfig({
        transportType: 'stdio' as unknown as 'http',
      })
    ).toThrow();
  });
});
