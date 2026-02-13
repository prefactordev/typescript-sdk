import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { AgentInstanceManager, Tracer } from '@prefactor/core';
import { init, shutdown, withSpan } from '../src/init.js';

const baseConfig = {
  transportType: 'http' as const,
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

    expect(registeredSchemas).toHaveLength(1);
  });

  test('registers default schema when no schema config is provided', () => {
    init(baseConfig);

    expect(registeredSchemas).toHaveLength(1);
    expect(registeredSchemas[0]).toMatchObject({
      external_identifier: 'ai-sdk-schema',
      span_schemas: {
        'ai-sdk:agent': { type: 'object', additionalProperties: true },
        'ai-sdk:llm': { type: 'object', additionalProperties: true },
        'ai-sdk:tool': { type: 'object', additionalProperties: true },
      },
      span_result_schemas: {
        'ai-sdk:agent': { type: 'object', additionalProperties: true },
        'ai-sdk:llm': { type: 'object', additionalProperties: true },
        'ai-sdk:tool': { type: 'object', additionalProperties: true },
      },
      span_result_schemas: {
        'ai-sdk:agent': { type: 'object', additionalProperties: true },
        'ai-sdk:llm': { type: 'object', additionalProperties: true },
        'ai-sdk:tool': { type: 'object', additionalProperties: true },
        'ai-sdk:chain': { type: 'object', additionalProperties: true },
      },
    });
    const schema = registeredSchemas[0] as {
      span_schemas: Record<string, unknown>;
      span_result_schemas: Record<string, unknown>;
    };
    expect(schema.span_schemas['ai-sdk:chain']).toBeUndefined();
    expect(schema.span_result_schemas['ai-sdk:chain']).toBeUndefined();
  });

  test('supports manual spans for custom workflow instrumentation', async () => {
    const startSpanSpy = spyOn(Tracer.prototype, 'startSpan');
    const endSpanSpy = spyOn(Tracer.prototype, 'endSpan').mockImplementation(() => {});

    try {
      init(baseConfig);

      const result = await withSpan(
        {
          name: 'test:example_workflow',
          spanType: 'test:example_workflow',
          inputs: { channel: 'alerts' },
        },
        async () => 'ok'
      );

      expect(result).toBe('ok');
      expect(startSpanSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test:example_workflow',
          spanType: 'test:example_workflow',
        })
      );
      expect(endSpanSpy).toHaveBeenCalledTimes(1);
    } finally {
      startSpanSpy.mockRestore();
      endSpanSpy.mockRestore();
    }
  });
});
