import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createCore } from '../src/create-core.js';
import { createConfig } from '../src/config.js';

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
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ details: { id: 'test-span' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requires agentVersion when using HTTP transport', () => {
    const config = createConfig({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
      },
    });

    expect(() => createCore(config)).toThrowError(/agentVersion/);
  });

  test('does not warn when skipSchema is enabled for HTTP transport', async () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const config = createConfig({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
        agentVersion: '1.0.0',
        skipSchema: true,
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

  test('does not warn when agentSchema is provided for HTTP transport', async () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const config = createConfig({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
        agentVersion: '1.0.0',
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

  test('warns when skipSchema is set for stdio transport', async () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const config = createConfig({
      transportType: 'stdio',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
        skipSchema: true,
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
});
