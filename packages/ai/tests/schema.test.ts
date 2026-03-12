import { describe, expect, test } from 'bun:test';
import { buildToolSpanSchema, GENERIC_OBJECT_SCHEMA } from '../src/tool-span-contract.js';
import {
  DEFAULT_AI_AGENT_SCHEMA,
  normalizeAgentSchema,
  resolveToolSpanType,
} from '../src/schema.js';

describe('ai schema normalization', () => {
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
      get_customer_profile: 'ai-sdk:tool:get-customer-profile',
    });
    expect(normalized.agentSchema).toEqual({
      ...DEFAULT_AI_AGENT_SCHEMA,
      external_identifier: 'custom-schema',
      span_schemas: {
        ...DEFAULT_AI_AGENT_SCHEMA.span_schemas,
        'ai-sdk:tool:get-customer-profile': buildToolSpanSchema(inputSchema),
      },
      span_result_schemas: {
        ...DEFAULT_AI_AGENT_SCHEMA.span_result_schemas,
        'ai-sdk:tool:get-customer-profile': GENERIC_OBJECT_SCHEMA,
      },
    });
  });

  test('normalizes configured tool span types before lookup', () => {
    const normalized = normalizeAgentSchema({
      toolSchemas: {
        send_email: {
          spanType: 'ai-sdk:tool:send-email',
          inputSchema: { type: 'object' },
        },
      },
    });

    expect(resolveToolSpanType('send_email', normalized.toolSpanTypes)).toBe(
      'ai-sdk:tool:send-email'
    );
    expect(resolveToolSpanType('unknown_tool', normalized.toolSpanTypes)).toBe('ai-sdk:tool');
  });

  test('rejects tool schemas whose normalized span types collide', () => {
    expect(() =>
      normalizeAgentSchema({
        toolSchemas: {
          get_customer_profile: {
            spanType: 'get-customer-profile',
            inputSchema: { type: 'object' },
          },
          lookup_customer: {
            spanType: 'ai-sdk:tool:get-customer-profile',
            inputSchema: { type: 'object' },
          },
        },
      })
    ).toThrow('conflicts with "get_customer_profile"');
  });
});
