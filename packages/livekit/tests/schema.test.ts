import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_LIVEKIT_AGENT_SCHEMA,
  normalizeAgentSchema,
  resolveToolSpanType,
} from '../src/schema.js';

describe('livekit schema', () => {
  test('default schema includes expected span types', () => {
    const spanTypes = DEFAULT_LIVEKIT_AGENT_SCHEMA.span_type_schemas.map(
      (schema) => schema.spanType
    );

    expect(spanTypes).toEqual([
      'livekit:session',
      'livekit:user_turn',
      'livekit:assistant_turn',
      'livekit:tool',
      'livekit:llm',
      'livekit:stt',
      'livekit:tts',
      'livekit:state',
      'livekit:error',
    ]);
    expect(DEFAULT_LIVEKIT_AGENT_SCHEMA.span_type_schemas.map((schema) => schema.name)).toEqual([
      'session',
      'user_turn',
      'assistant_turn',
      'tool',
      'llm',
      'stt',
      'tts',
      'state',
      'error',
    ]);
  });

  test('default span type schemas include first-class display templates', () => {
    for (const spanSchema of DEFAULT_LIVEKIT_AGENT_SCHEMA.span_type_schemas) {
      expect(spanSchema.template).toEqual(expect.any(String));
      expect(spanSchema.template.length).toBeGreaterThan(0);
    }
  });

  test('normalizes default schema to span_type_schemas', () => {
    const normalized = normalizeAgentSchema(DEFAULT_LIVEKIT_AGENT_SCHEMA);

    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{
      spanType: string;
      name: string;
      template?: string;
      params_schema: Record<string, unknown>;
      result_schema: Record<string, unknown>;
    }>;

    for (const spanSchema of spanTypeSchemas) {
      expect(spanSchema.spanType).toEqual(expect.stringContaining('livekit:'));
      expect(spanSchema.name).not.toEqual(spanSchema.spanType);
      expect(spanSchema.template).toEqual(expect.any(String));
      expect(spanSchema.result_schema).toEqual(expect.any(Object));
    }
  });

  test('normalizes tool span type suffixes', () => {
    const normalized = normalizeAgentSchema({
      ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
      toolSchemas: {
        lookupWeather: {
          spanType: 'lookup-weather',
          inputSchema: { type: 'object' },
        },
      },
    });

    expect(resolveToolSpanType('lookupWeather', normalized.toolSpanTypes)).toBe(
      'livekit:tool:lookup-weather'
    );
    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{
      spanType: string;
      name: string;
      template?: string;
      params_schema: { properties?: { type?: { const?: string } } };
      result_schema: Record<string, unknown>;
    }>;
    const customToolSchema = spanTypeSchemas.find(
      (spanSchema) => spanSchema.spanType === 'livekit:tool:lookup-weather'
    );
    expect(customToolSchema).toBeDefined();
    expect(customToolSchema?.name).toBe('lookupWeather');
    expect(customToolSchema?.template).toEqual(expect.any(String));
    expect(customToolSchema?.params_schema.properties?.type?.const).toBe(
      'livekit:tool:lookup-weather'
    );
    expect(customToolSchema?.result_schema).toEqual(expect.any(Object));
  });

  test('drops invalid tool schema objects', () => {
    const normalized = normalizeAgentSchema({
      ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
      toolSchemas: {
        broken: 'not-an-object',
      },
    });

    expect(resolveToolSpanType('broken', normalized.toolSpanTypes)).toBe('livekit:tool');
    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{ spanType: string }>;
    expect(spanTypeSchemas.map((spanSchema) => spanSchema.spanType)).not.toContain(
      'livekit:tool:broken'
    );
  });

  test('drops colliding normalized tool span types', () => {
    const normalized = normalizeAgentSchema({
      ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
      toolSchemas: {
        first: {
          spanType: 'lookup-weather',
          inputSchema: { type: 'object' },
        },
        second: {
          spanType: 'livekit:tool:lookup-weather',
          inputSchema: { type: 'object' },
        },
      },
    });

    expect(normalized.toolSpanTypes).toEqual({
      first: 'livekit:tool:lookup-weather',
    });
  });

  test('normalizes missing result schemas to open objects', () => {
    const normalized = normalizeAgentSchema({
      external_identifier: 'livekit-schema',
      span_type_schemas: [
        {
          spanType: 'livekit:custom',
          name: 'custom',
          params_schema: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'livekit:custom' },
            },
          },
        },
      ],
    });

    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{
      spanType: string;
      name: string;
      result_schema: Record<string, unknown>;
    }>;
    const customSchema = spanTypeSchemas.find(
      (spanSchema) => spanSchema.spanType === 'livekit:custom'
    );

    expect(customSchema?.result_schema).toEqual({
      type: 'object',
      additionalProperties: true,
    });
  });

  test('partial built-in overrides preserve default result schemas', () => {
    const normalized = normalizeAgentSchema({
      external_identifier: 'livekit-schema',
      span_type_schemas: [
        {
          spanType: 'livekit:session',
          name: 'voice session',
          template: 'Custom session template',
          params_schema: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'livekit:session' },
            },
          },
        },
      ],
    });

    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{
      spanType: string;
      name: string;
      template?: string;
      result_schema?: Record<string, unknown>;
    }>;
    const sessionSchema = spanTypeSchemas.find(
      (spanSchema) => spanSchema.spanType === 'livekit:session'
    );

    expect(sessionSchema?.name).toBe('voice session');
    expect(sessionSchema?.template).toBe('Custom session template');
    expect(sessionSchema?.result_schema).toEqual(expect.any(Object));
    expect(sessionSchema?.result_schema).not.toEqual(undefined);
  });

  test('normalizes legacy span schema maps into span_type_schemas', () => {
    const normalized = normalizeAgentSchema({
      external_identifier: 'legacy-livekit-schema',
      span_schemas: {
        'livekit:session': {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'livekit:session' },
            customInput: { type: 'string' },
          },
        },
        'livekit:custom': {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'livekit:custom' },
          },
        },
      },
      span_result_schemas: {
        'livekit:custom': {
          type: 'object',
          properties: {
            customOutput: { type: 'string' },
          },
        },
      },
    });

    expect(normalized.agentSchema).not.toHaveProperty('span_schemas');
    expect(normalized.agentSchema).not.toHaveProperty('span_result_schemas');
    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{
      spanType: string;
      name: string;
      params_schema: Record<string, unknown>;
      result_schema: Record<string, unknown>;
    }>;
    const sessionSchema = spanTypeSchemas.find(
      (spanSchema) => spanSchema.spanType === 'livekit:session'
    );
    const customSchema = spanTypeSchemas.find(
      (spanSchema) => spanSchema.spanType === 'livekit:custom'
    );

    expect(sessionSchema?.params_schema).toMatchObject({
      properties: {
        customInput: { type: 'string' },
      },
    });
    expect(sessionSchema?.result_schema).toEqual(expect.any(Object));
    expect(customSchema).toMatchObject({
      spanType: 'livekit:custom',
      name: 'custom',
      result_schema: {
        type: 'object',
        properties: {
          customOutput: { type: 'string' },
        },
      },
    });
  });

  test('normalization removes toolSchemas from returned schema', () => {
    const normalized = normalizeAgentSchema({
      external_identifier: 'livekit-schema',
      toolSchemas: {
        lookupWeather: {
          spanType: 'lookup-weather',
          inputSchema: { type: 'object' },
        },
      },
    });

    expect(normalized.agentSchema).not.toHaveProperty('toolSchemas');
    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{
      spanType: string;
    }>;
    expect(spanTypeSchemas.map((spanSchema) => spanSchema.spanType)).toContain(
      'livekit:tool:lookup-weather'
    );
  });
});
