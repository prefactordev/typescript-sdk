import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createConfig } from '../src/config.js';
import { createCore } from '../src/create-core.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from '../src/version.js';
import { getActiveTracer } from '../src/tracing/active-tracer.js';
import { withSpan } from '../src/tracing/with-span.js';
import {
  createSdkHeaderFetchRecorder,
  expectRuntimeMetadataOmitted,
  expectSdkHeaderHeaders,
} from './shared/sdk-header.js';

const createWarnSpy = () => {
  const warnMessages: string[] = [];
  const warnSpy = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnMessages.push(args.map(String).join(' '));
  });

  return { warnMessages, warnSpy };
};

const CORE_SDK_HEADER_ENTRY = `${PACKAGE_NAME.replace(/^@/, '')}@${PACKAGE_VERSION}`;

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

  test('throws when createCore is called without httpConfig', () => {
    const config = createConfig({
      transportType: 'http',
    });

    expect(() => createCore(config)).toThrow(/requires httpConfig/i);
  });

  test('rejects invalid HTTP config values during config creation', () => {
    expect(() =>
      createConfig({
        transportType: 'http',
        httpConfig: {
          apiUrl: 'not-a-url',
          apiToken: '',
        } as never,
      })
    ).toThrow();
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

  test('emits only the core sdk header by default', async () => {
    const recorder = createSdkHeaderFetchRecorder();
    globalThis.fetch = recorder.fetch;
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
    let isShutdown = false;

    try {
      core.agentManager.startInstance({ agentId: 'agent-1' });
      await core.shutdown();
      isShutdown = true;

      const headers = recorder.getRegisterHeaders();
      const payload = recorder.getRegisterPayload();

      expect(headers.get('X-Prefactor-SDK')).toBe(CORE_SDK_HEADER_ENTRY);
      expectRuntimeMetadataOmitted(payload);
    } finally {
      if (!isShutdown) {
        await core.shutdown();
      }
    }
  });

  test('appends adapter sdk header when provided in createCore options', async () => {
    const recorder = createSdkHeaderFetchRecorder();
    globalThis.fetch = recorder.fetch;
    const config = createConfig({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
        agentIdentifier: '1.0.0',
        agentSchema: { type: 'object' },
      },
    });
    const core = createCore(config, { sdkHeaderEntry: '@prefactor/ai@0.3.1' });
    let isShutdown = false;

    try {
      core.agentManager.startInstance({ agentId: 'agent-1' });
      await core.shutdown();
      isShutdown = true;

      expectSdkHeaderHeaders(recorder.getRegisterHeaders(), 'prefactor/ai@0.3.1');
    } finally {
      if (!isShutdown) {
        await core.shutdown();
      }
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

  test('clears active tracer when shutdown rejects with partial telemetry', async () => {
    globalThis.fetch = (async (url) => {
      if (String(url).endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (String(url).endsWith('/agent_spans')) {
        return new Response(JSON.stringify({ details: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const core = createCore(
      createConfig({
        transportType: 'http',
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'test-token',
          agentIdentifier: '1.0.0',
        },
      })
    );

    await withSpan(
      {
        name: 'partial-telemetry',
        spanType: 'custom:partial-telemetry',
        inputs: {},
      },
      async () => ({ ok: true })
    );

    expect(getActiveTracer()).toBeDefined();
    await expect(core.shutdown()).rejects.toMatchObject({
      kind: 'partial_telemetry',
    });
    expect(getActiveTracer()).toBeUndefined();
    await expect(
      withSpan(
        {
          name: 'missing-tracer-after-shutdown',
          spanType: 'custom:missing-tracer-after-shutdown',
          inputs: {},
        },
        async () => ({ ok: true })
      )
    ).rejects.toThrow(/No active tracer found/i);
  });

  test('rejects stdio transport type', () => {
    expect(() =>
      createConfig({
        transportType: 'stdio' as unknown as 'http',
      })
    ).toThrow();
  });
});
