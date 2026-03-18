import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CLAUDE_AGENT_SCHEMA,
  normalizeAgentSchema,
  resolveToolSpanType,
} from '../src/schema.js';

describe('DEFAULT_CLAUDE_AGENT_SCHEMA', () => {
  test('has all four span types in span_schemas', () => {
    const schemas = DEFAULT_CLAUDE_AGENT_SCHEMA.span_schemas;
    expect(schemas).toHaveProperty('claude:agent');
    expect(schemas).toHaveProperty('claude:llm');
    expect(schemas).toHaveProperty('claude:tool');
    expect(schemas).toHaveProperty('claude:subagent');
  });

  test('has all four span types in span_result_schemas', () => {
    const schemas = DEFAULT_CLAUDE_AGENT_SCHEMA.span_result_schemas;
    expect(schemas).toHaveProperty('claude:agent');
    expect(schemas).toHaveProperty('claude:llm');
    expect(schemas).toHaveProperty('claude:tool');
    expect(schemas).toHaveProperty('claude:subagent');
  });

  test('has external_identifier', () => {
    expect(DEFAULT_CLAUDE_AGENT_SCHEMA.external_identifier).toBe('claude-schema');
  });
});

describe('normalizeAgentSchema', () => {
  test('returns default schema when no input provided', () => {
    const result = normalizeAgentSchema(undefined);
    expect(result.agentSchema).toBeDefined();
    expect(result.toolSpanTypes).toBeUndefined();
  });

  test('extracts toolSpanTypes from toolSchemas', () => {
    const schema = {
      ...DEFAULT_CLAUDE_AGENT_SCHEMA,
      toolSchemas: {
        Read: {
          spanType: 'claude:tool:read',
          inputSchema: {
            type: 'object',
            properties: { file_path: { type: 'string' } },
          },
        },
        Bash: {
          spanType: 'claude:tool:bash',
          inputSchema: {
            type: 'object',
            properties: { command: { type: 'string' } },
          },
        },
      },
    };

    const result = normalizeAgentSchema(schema);
    expect(result.toolSpanTypes).toBeDefined();
    expect(result.toolSpanTypes?.Read).toBe('claude:tool:read');
    expect(result.toolSpanTypes?.Bash).toBe('claude:tool:bash');
  });

  test('adds tool-specific span types to span_schemas', () => {
    const schema = {
      ...DEFAULT_CLAUDE_AGENT_SCHEMA,
      toolSchemas: {
        Grep: {
          spanType: 'claude:tool:grep',
          inputSchema: {
            type: 'object',
            properties: { pattern: { type: 'string' } },
          },
        },
      },
    };

    const result = normalizeAgentSchema(schema);
    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic schema structure
    const spanSchemas = (result.agentSchema as any).span_schemas;
    expect(spanSchemas).toHaveProperty('claude:tool:grep');
  });

  test('adds tool-specific span types to span_result_schemas', () => {
    const schema = {
      ...DEFAULT_CLAUDE_AGENT_SCHEMA,
      toolSchemas: {
        Grep: {
          spanType: 'claude:tool:grep',
          inputSchema: {
            type: 'object',
            properties: { pattern: { type: 'string' } },
          },
        },
      },
    };

    const result = normalizeAgentSchema(schema);
    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic schema structure
    const resultSchemas = (result.agentSchema as any).span_result_schemas;
    expect(resultSchemas).toHaveProperty('claude:tool:grep');
  });

  test('preserves base span types alongside tool-specific ones', () => {
    const schema = {
      ...DEFAULT_CLAUDE_AGENT_SCHEMA,
      toolSchemas: {
        Read: {
          spanType: 'claude:tool:read',
          inputSchema: { type: 'object' },
        },
      },
    };

    const result = normalizeAgentSchema(schema);
    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic schema structure
    const spanSchemas = (result.agentSchema as any).span_schemas;
    expect(spanSchemas).toHaveProperty('claude:agent');
    expect(spanSchemas).toHaveProperty('claude:llm');
    expect(spanSchemas).toHaveProperty('claude:tool');
    expect(spanSchemas).toHaveProperty('claude:subagent');
    expect(spanSchemas).toHaveProperty('claude:tool:read');
  });
});

describe('resolveToolSpanType', () => {
  test('returns mapped span type when available', () => {
    const toolSpanTypes = { Read: 'claude:tool:read', Bash: 'claude:tool:bash' };
    expect(resolveToolSpanType('Read', toolSpanTypes)).toBe('claude:tool:read');
    expect(resolveToolSpanType('Bash', toolSpanTypes)).toBe('claude:tool:bash');
  });

  test('falls back to claude:tool for unmapped tools', () => {
    const toolSpanTypes = { Read: 'claude:tool:read' };
    expect(resolveToolSpanType('WebFetch', toolSpanTypes)).toBe('claude:tool');
  });

  test('returns claude:tool when no toolSpanTypes provided', () => {
    expect(resolveToolSpanType('Read', undefined)).toBe('claude:tool');
  });
});
