import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { AgentInstanceManager, getClient, init as initCore, Tracer } from '@prefactor/core';
import {
  createSdkHeaderFetchRecorder,
  expectRuntimeMetadataOmitted,
  expectSdkHeaderHeaders,
} from '../../core/tests/shared/sdk-header.js';
import { init, shutdown, withSpan } from '../src/init.js';
import { PrefactorLangChain } from '../src/provider.js';
import { buildToolSpanSchema } from '../src/tool-span-contract.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from '../src/version.js';

const baseConfig = {
  transportType: 'http' as const,
  httpConfig: {
    apiUrl: 'https://example.com',
    apiToken: 'test-token',
    agentIdentifier: '1.0.0',
  },
};

const LANGCHAIN_SDK_HEADER_ENTRY = `${PACKAGE_NAME.replace(/^@/, '')}@${PACKAGE_VERSION}`;

describe('langchain init schema registration', () => {
  const originalRegisterSchema = AgentInstanceManager.prototype.registerSchema;
  const originalFetch = globalThis.fetch;
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
    globalThis.fetch = originalFetch;
    await shutdown();
    await getClient()?.shutdown();
  });

  test('merges provided agent schema with the default LangChain schema', () => {
    const customSchema = { type: 'object', title: 'Custom' };

    init({
      ...baseConfig,
      httpConfig: { ...baseConfig.httpConfig, agentSchema: customSchema },
    });

    expect(registeredSchemas).toEqual([
      {
        external_identifier: 'langchain-schema',
        span_schemas: {
          'langchain:agent': { type: 'object', additionalProperties: true },
          'langchain:llm': { type: 'object', additionalProperties: true },
          'langchain:tool': { type: 'object', additionalProperties: true },
          'langchain:chain': { type: 'object', additionalProperties: true },
        },
        span_result_schemas: {
          'langchain:agent': { type: 'object', additionalProperties: true },
          'langchain:llm': { type: 'object', additionalProperties: true },
          'langchain:tool': { type: 'object', additionalProperties: true },
          'langchain:chain': { type: 'object', additionalProperties: true },
        },
        ...customSchema,
      },
    ]);
  });

  test('registers default schema when schema is not configured', () => {
    init({
      ...baseConfig,
    });

    expect(registeredSchemas).toHaveLength(1);
    expect(registeredSchemas[0]).toMatchObject({
      external_identifier: 'langchain-schema',
      span_schemas: expect.any(Object),
      span_result_schemas: {
        'langchain:agent': { type: 'object', additionalProperties: true },
        'langchain:llm': { type: 'object', additionalProperties: true },
        'langchain:tool': { type: 'object', additionalProperties: true },
        'langchain:chain': { type: 'object', additionalProperties: true },
      },
    });
  });

  test('registers default schema when no schema config is provided', () => {
    init(baseConfig);

    expect(registeredSchemas).toHaveLength(1);
  });

  test('compiles toolSchemas into registered schemas for the core provider path', () => {
    initCore({
      provider: new PrefactorLangChain(),
      httpConfig: {
        ...baseConfig.httpConfig,
        agentIdentifier: '1.0.1',
        agentSchema: {
          external_identifier: 'langchain-tool-schema-test-v1',
          span_schemas: {},
          span_result_schemas: {},
          toolSchemas: {
            get_customer_profile: {
              spanType: 'get-customer-profile',
              inputSchema: {
                type: 'object',
                properties: {
                  customerId: { type: 'string' },
                },
                required: ['customerId'],
              },
            },
          },
        },
      },
    });

    expect(registeredSchemas).toHaveLength(1);
    const schema = registeredSchemas[0] as {
      span_schemas: Record<string, unknown>;
      span_result_schemas: Record<string, unknown>;
      toolSchemas?: unknown;
    };
    expect(schema.toolSchemas).toBeUndefined();
    expect(schema.span_schemas['langchain:tool:get-customer-profile']).toEqual(
      buildToolSpanSchema({
        type: 'object',
        properties: {
          customerId: { type: 'string' },
        },
        required: ['customerId'],
      })
    );
    expect(schema.span_result_schemas['langchain:tool:get-customer-profile']).toEqual({
      type: 'object',
      additionalProperties: true,
    });
  });

  test('compiles toolSchemas into registered schemas for package init', () => {
    init({
      ...baseConfig,
      httpConfig: {
        ...baseConfig.httpConfig,
        agentIdentifier: '1.0.2',
        agentSchema: {
          external_identifier: 'langchain-tool-schema-test-v2',
          span_schemas: {},
          span_result_schemas: {},
          toolSchemas: {
            send_email: {
              spanType: 'send-email',
              inputSchema: {
                type: 'object',
                properties: {
                  to: { type: 'string' },
                  subject: { type: 'string' },
                },
                required: ['to', 'subject'],
              },
            },
          },
        },
      },
    });

    const schema = registeredSchemas[0] as {
      span_schemas: Record<string, unknown>;
      span_result_schemas: Record<string, unknown>;
      toolSchemas?: unknown;
    };
    expect(schema.toolSchemas).toBeUndefined();
    expect(schema.span_schemas['langchain:tool:send-email']).toEqual(
      buildToolSpanSchema({
        type: 'object',
        properties: {
          to: { type: 'string' },
          subject: { type: 'string' },
        },
        required: ['to', 'subject'],
      })
    );
    expect(schema.span_result_schemas['langchain:tool:send-email']).toEqual({
      type: 'object',
      additionalProperties: true,
    });
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
          inputs: { method: 'POST' },
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

  test('sends adapter sdk header for package init and omits runtime metadata body fields', async () => {
    const recorder = createSdkHeaderFetchRecorder({ includeSpanResponses: true });
    globalThis.fetch = recorder.fetch;

    init(baseConfig);
    await withSpan(
      {
        name: 'test:header',
        spanType: 'langchain:llm',
        inputs: { prompt: 'hi' },
      },
      async () => 'ok'
    );
    await shutdown();

    expectSdkHeaderHeaders(recorder.getRegisterHeaders(), LANGCHAIN_SDK_HEADER_ENTRY);
    expectRuntimeMetadataOmitted(recorder.getRegisterPayload());
  });

  test('sends adapter sdk header for the core provider path', async () => {
    const recorder = createSdkHeaderFetchRecorder();
    globalThis.fetch = recorder.fetch;

    const prefactor = initCore({
      provider: new PrefactorLangChain(),
      httpConfig: baseConfig.httpConfig,
    });
    prefactor.getTracer().startAgentInstance();
    await prefactor.shutdown();

    expectSdkHeaderHeaders(recorder.getRegisterHeaders(), LANGCHAIN_SDK_HEADER_ENTRY);
  });
});
