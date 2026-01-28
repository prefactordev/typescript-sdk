import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AgentInstanceManager } from '@prefactor/core';
import { init, shutdown } from '../src/init.js';

const baseConfig = {
  transportType: 'stdio' as const,
  httpConfig: {
    apiUrl: 'https://example.com',
    apiToken: 'test-token',
    agentVersion: '1.0.0',
  },
};

describe('ai init schema registration', () => {
  const originalRegisterSchema = AgentInstanceManager.prototype.registerSchema;
  let registeredSchemas: Record<string, unknown>[] = [];

  beforeEach(() => {
    registeredSchemas = [];
    AgentInstanceManager.prototype.registerSchema = function registerSchemaStub(
      schema: Record<string, unknown>
    ) {
      registeredSchemas.push(schema);
    };
  });

  afterEach(async () => {
<<<<<<< HEAD
    await shutdown();
    globalThis.fetch = originalFetch;
  });

  test('skipSchema is only honored for HTTP transport', async () => {
    init({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://api.prefactor.ai',
        apiToken: 'test-token',
        agentVersion: '1.0.0',
        skipSchema: true,
      },
    });

    const tracer = getTracer();
    const span = tracer.startSpan({
      name: 'agent-span',
      spanType: SpanType.AGENT,
      inputs: {},
    });
    tracer.endSpan(span);

    await waitFor(() =>
      fetchCalls.some((call) => call.url.endsWith('/api/v1/agent_instance/register'))
    );

    const registerCall = fetchCalls.find((call) =>
      call.url.endsWith('/api/v1/agent_instance/register')
    );

    expect(registerCall?.body).toBeDefined();
    expect((registerCall?.body as Record<string, unknown>).agent_schema_version).toBeUndefined();
  });

  test('agentSchemaVersion is applied for HTTP transport', async () => {
    init({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://api.prefactor.ai',
        apiToken: 'test-token',
        agentVersion: '1.0.0',
        agentSchemaVersion: 'v2.0.0',
      },
    });

    const tracer = getTracer();
    const span = tracer.startSpan({
      name: 'agent-span',
      spanType: SpanType.AGENT,
      inputs: {},
    });
    tracer.endSpan(span);

    await waitFor(() =>
      fetchCalls.some((call) => call.url.endsWith('/api/v1/agent_instance/register'))
    );

    const registerCall = fetchCalls.find((call) =>
      call.url.endsWith('/api/v1/agent_instance/register')
    );

    const schemaVersion = (registerCall?.body as Record<string, unknown>).agent_schema_version as {
      external_identifier?: string;
    };

    expect(schemaVersion?.external_identifier).toBe('v2.0.0');
=======
    AgentInstanceManager.prototype.registerSchema = originalRegisterSchema;
    await shutdown();
  });

  test('registers provided agent schema when configured', () => {
    const customSchema = { type: 'object', title: 'Custom' };

    init({
      ...baseConfig,
      httpConfig: { ...baseConfig.httpConfig, agentSchema: customSchema },
    });

    expect(registeredSchemas).toEqual([customSchema]);
  });

  test('skips default schema when agentSchemaVersion is set', () => {
    init({
      ...baseConfig,
      transportType: 'http',
      httpConfig: { ...baseConfig.httpConfig, agentSchemaVersion: '2.0.0' },
    });

    expect(registeredSchemas).toEqual([]);
  });

  test('registers default schema when no schema config is provided', () => {
    init(baseConfig);

    expect(registeredSchemas.length).toBe(1);
>>>>>>> refactor/sdk-vnext
  });
});
