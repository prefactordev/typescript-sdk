import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AgentInstanceManager } from '@prefactor/core';
import { init, shutdown } from '../src/init.js';

const baseConfig = {
  transportType: 'stdio' as const,
  httpConfig: {
    apiUrl: 'https://example.com',
    apiToken: 'test-token',
    agentIdentifier: '1.0.0',
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

  test('registers default schema when only agentIdentifier is set', () => {
    init({
      ...baseConfig,
      transportType: 'http',
      httpConfig: { ...baseConfig.httpConfig, agentIdentifier: '2.0.0' },
    });

    expect(registeredSchemas.length).toBe(1);
  });

  test('registers default schema when no schema config is provided', () => {
    init(baseConfig);

    expect(registeredSchemas.length).toBe(1);
  });
});
