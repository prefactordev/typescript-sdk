import { describe, expect, spyOn, test } from 'bun:test';
import { normalizeAgentToolSchemas } from '../src/tool-schema.js';

describe('normalizeAgentToolSchemas', () => {
  test('warns and ignores invalid toolSchemas without throwing', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const normalized = normalizeAgentToolSchemas(
        {
          external_identifier: 'custom-schema',
          toolSchemas: 'bad-config' as unknown as Record<string, unknown>,
        },
        {
          defaultAgentSchema: {
            external_identifier: 'default-schema',
            span_schemas: {
              'custom:tool': { type: 'object', additionalProperties: true },
            },
            span_result_schemas: {
              'custom:tool': { type: 'object', additionalProperties: true },
            },
          },
          providerName: 'custom',
        }
      );

      expect(normalized.toolSchemas).toBeUndefined();
      expect(normalized.toolSpanTypes).toBeUndefined();
      expect(normalized.agentSchema).toEqual({
        external_identifier: 'custom-schema',
        span_schemas: {
          'custom:tool': { type: 'object', additionalProperties: true },
        },
        span_result_schemas: {
          'custom:tool': { type: 'object', additionalProperties: true },
        },
      });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
