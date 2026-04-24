import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_LIVEKIT_AGENT_SCHEMA,
  normalizeAgentSchema,
  resolveToolSpanType,
} from '../src/schema.js';

describe('livekit schema', () => {
  test('default schema includes expected span types', () => {
    const spanNames = DEFAULT_LIVEKIT_AGENT_SCHEMA.span_type_schemas.map((schema) => schema.name);

    expect(spanNames).toEqual([
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
  });

  test('default span type schemas include first-class display templates', () => {
    for (const spanSchema of DEFAULT_LIVEKIT_AGENT_SCHEMA.span_type_schemas) {
      expect(spanSchema.template).toEqual(expect.any(String));
      expect(spanSchema.template.length).toBeGreaterThan(0);
      expect(spanSchema.template).not.toContain('| default:');
      expect(spanSchema.template).not.toContain('metrics.metadata.modelName');
      expect(spanSchema.params_schema).not.toHaveProperty('prefactor:template');
    }
  });

  test('normalizes default schema to span_type_schemas', () => {
    const normalized = normalizeAgentSchema(DEFAULT_LIVEKIT_AGENT_SCHEMA);

    expect(normalized.agentSchema).not.toHaveProperty('span_schemas');
    expect(normalized.agentSchema).not.toHaveProperty('span_result_schemas');
    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{
      name: string;
      template?: string;
      params_schema: Record<string, unknown>;
      result_schema: Record<string, unknown>;
    }>;

    for (const spanSchema of spanTypeSchemas) {
      expect(spanSchema.template).toEqual(expect.any(String));
      expect(spanSchema.params_schema).not.toHaveProperty('prefactor:template');
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
      name: string;
      template?: string;
      params_schema: { properties?: { type?: { const?: string } } };
      result_schema: Record<string, unknown>;
    }>;
    const customToolSchema = spanTypeSchemas.find(
      (spanSchema) => spanSchema.name === 'livekit:tool:lookup-weather'
    );
    expect(customToolSchema).toBeDefined();
    expect(customToolSchema?.template).toEqual(expect.any(String));
    expect(customToolSchema?.params_schema.properties?.type?.const).toBe(
      'livekit:tool:lookup-weather'
    );
    expect(customToolSchema?.params_schema).not.toHaveProperty('prefactor:template');
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
    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{ name: string }>;
    expect(spanTypeSchemas.map((spanSchema) => spanSchema.name)).not.toContain(
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

  test('normalizes legacy span_schemas input to span_type_schemas', () => {
    const normalized = normalizeAgentSchema({
      external_identifier: 'legacy-livekit-schema',
      span_schemas: {
        'livekit:session': {
          type: 'object',
          title: 'LiveKit session',
          description: 'Session lifecycle',
          'prefactor:template': 'Session {{ status }}',
          properties: {
            type: { type: 'string', const: 'livekit:session' },
          },
        },
      },
      span_result_schemas: {
        'livekit:session': {
          type: 'object',
          properties: {
            status: { type: 'string' },
          },
        },
      },
    });

    expect(normalized.agentSchema).not.toHaveProperty('span_schemas');
    expect(normalized.agentSchema).not.toHaveProperty('span_result_schemas');

    const spanTypeSchemas = normalized.agentSchema.span_type_schemas as Array<{
      name: string;
      title?: string;
      description?: string;
      template?: string;
      params_schema: Record<string, unknown>;
      result_schema: Record<string, unknown>;
    }>;
    const sessionSchema = spanTypeSchemas.find(
      (spanSchema) => spanSchema.name === 'livekit:session'
    );

    expect(sessionSchema).toMatchObject({
      name: 'livekit:session',
      title: 'LiveKit session',
      description: 'Session lifecycle',
      template: 'Session {{ status }}',
      result_schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
        },
      },
    });
    expect(sessionSchema?.params_schema).toEqual({
      type: 'object',
      properties: {
        type: { type: 'string', const: 'livekit:session' },
      },
    });
  });
});
