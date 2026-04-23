import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_LIVEKIT_AGENT_SCHEMA,
  normalizeAgentSchema,
  resolveToolSpanType,
} from '../src/schema.js';

describe('livekit schema', () => {
  test('default schema includes expected span types', () => {
    const schema = DEFAULT_LIVEKIT_AGENT_SCHEMA.span_schemas;
    expect(schema).toHaveProperty('livekit:session');
    expect(schema).toHaveProperty('livekit:user_turn');
    expect(schema).toHaveProperty('livekit:assistant_turn');
    expect(schema).toHaveProperty('livekit:tool');
    expect(schema).toHaveProperty('livekit:llm');
    expect(schema).toHaveProperty('livekit:stt');
    expect(schema).toHaveProperty('livekit:tts');
    expect(schema).toHaveProperty('livekit:state');
    expect(schema).toHaveProperty('livekit:error');
  });

  test('default span schemas include display templates', () => {
    const schema = DEFAULT_LIVEKIT_AGENT_SCHEMA.span_schemas as Record<
      string,
      Record<string, unknown>
    >;

    for (const spanSchema of Object.values(schema)) {
      expect(spanSchema['prefactor:template']).toEqual(expect.any(String));
      expect((spanSchema['prefactor:template'] as string).length).toBeGreaterThan(0);
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
    const spanSchemas = normalized.agentSchema.span_schemas as Record<string, unknown>;
    expect(spanSchemas).toHaveProperty('livekit:tool:lookup-weather');
    expect(
      (
        spanSchemas['livekit:tool:lookup-weather'] as {
          properties?: { type?: { const?: string } };
        }
      ).properties?.type?.const
    ).toBe('livekit:tool:lookup-weather');
  });

  test('drops invalid tool schema objects', () => {
    const normalized = normalizeAgentSchema({
      ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
      toolSchemas: {
        broken: 'not-an-object',
      },
    });

    expect(resolveToolSpanType('broken', normalized.toolSpanTypes)).toBe('livekit:tool');
    const spanSchemas = normalized.agentSchema.span_schemas as Record<string, unknown>;
    expect(spanSchemas).not.toHaveProperty('livekit:tool:broken');
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
});
