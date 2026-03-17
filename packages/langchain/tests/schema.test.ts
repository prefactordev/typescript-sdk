import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  DEFAULT_LANGCHAIN_AGENT_SCHEMA,
  normalizeAgentSchema,
  resolveToolSpanType,
} from '../src/schema.js';
import { buildToolSpanSchema, GENERIC_OBJECT_SCHEMA } from '../src/tool-span-contract.js';

describe('langchain schema normalization', () => {
  let warnSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = undefined;
  });

  test('adds tool-specific span schemas and span type mappings', () => {
    const inputSchema = {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
      },
      required: ['customerId'],
    };

    const normalized = normalizeAgentSchema({
      external_identifier: 'custom-schema',
      span_schemas: {},
      span_result_schemas: {},
      toolSchemas: {
        get_customer_profile: {
          spanType: 'get-customer-profile',
          inputSchema,
        },
      },
    });

    expect(normalized.toolSpanTypes).toEqual({
      get_customer_profile: 'langchain:tool:get-customer-profile',
    });
    expect(normalized.agentSchema).toEqual({
      ...DEFAULT_LANGCHAIN_AGENT_SCHEMA,
      external_identifier: 'custom-schema',
      span_schemas: {
        ...DEFAULT_LANGCHAIN_AGENT_SCHEMA.span_schemas,
        'langchain:tool:get-customer-profile': buildToolSpanSchema(inputSchema),
      },
      span_result_schemas: {
        ...DEFAULT_LANGCHAIN_AGENT_SCHEMA.span_result_schemas,
        'langchain:tool:get-customer-profile': GENERIC_OBJECT_SCHEMA,
      },
    });
  });

  test('normalizes configured tool span types before lookup', () => {
    const normalized = normalizeAgentSchema({
      toolSchemas: {
        send_email: {
          spanType: 'langchain:tool:send-email',
          inputSchema: { type: 'object' },
        },
      },
    });

    expect(resolveToolSpanType('send_email', normalized.toolSpanTypes)).toBe(
      'langchain:tool:send-email'
    );
    expect(resolveToolSpanType('unknown_tool', normalized.toolSpanTypes)).toBe('langchain:tool');
  });

  test('warns and skips tool schemas whose normalized span types collide', () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const normalized = normalizeAgentSchema({
      toolSchemas: {
        get_customer_profile: {
          spanType: 'get-customer-profile',
          inputSchema: { type: 'object' },
        },
        lookup_customer: {
          spanType: 'langchain:tool:get-customer-profile',
          inputSchema: { type: 'object' },
        },
      },
    });

    expect(normalized.toolSpanTypes).toEqual({
      get_customer_profile: 'langchain:tool:get-customer-profile',
    });
    expect(normalized.agentSchema).toEqual({
      ...DEFAULT_LANGCHAIN_AGENT_SCHEMA,
      span_schemas: {
        ...DEFAULT_LANGCHAIN_AGENT_SCHEMA.span_schemas,
        'langchain:tool:get-customer-profile': buildToolSpanSchema({ type: 'object' }),
      },
      span_result_schemas: {
        ...DEFAULT_LANGCHAIN_AGENT_SCHEMA.span_result_schemas,
        'langchain:tool:get-customer-profile': GENERIC_OBJECT_SCHEMA,
      },
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  test('warns and ignores invalid toolSchemas config without breaking normalization', () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const normalized = normalizeAgentSchema({
      external_identifier: 'custom-schema',
      toolSchemas: 'bad-config' as unknown as Record<string, unknown>,
    });

    expect(normalized.toolSpanTypes).toBeUndefined();
    expect(normalized.agentSchema).toEqual({
      ...DEFAULT_LANGCHAIN_AGENT_SCHEMA,
      external_identifier: 'custom-schema',
    });
    expect(warnSpy).toHaveBeenCalled();
  });
});
