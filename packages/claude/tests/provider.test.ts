import { describe, expect, test } from 'bun:test';
import { DEFAULT_CLAUDE_AGENT_SCHEMA, PrefactorClaude } from '../src/index.js';

describe('PrefactorClaude', () => {
  test('getDefaultAgentSchema returns DEFAULT_CLAUDE_AGENT_SCHEMA', () => {
    const provider = new PrefactorClaude();
    expect(provider.getDefaultAgentSchema()).toEqual(DEFAULT_CLAUDE_AGENT_SCHEMA);
  });

  test('getDefaultAgentSchema returns custom schema when provided', () => {
    const custom = { external_identifier: 'custom' };
    const provider = new PrefactorClaude({ agentSchema: custom });
    expect(provider.getDefaultAgentSchema()).toEqual(custom);
  });

  test('normalizeAgentSchema extracts tool span types', () => {
    const provider = new PrefactorClaude();
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
      },
    };

    const result = provider.normalizeAgentSchema(schema);

    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic schema structure
    const spanSchemas = (result as any).span_schemas;
    expect(spanSchemas).toHaveProperty('claude:tool:read');
  });

  test('createMiddleware returns object with tracedQuery', () => {
    const provider = new PrefactorClaude();

    const mockTracer = {
      startSpan: () => ({}),
      endSpan: () => {},
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    };

    const mockAgentManager = {
      startInstance: () => {},
      finishInstance: () => {},
    };

    const mockConfig = {
      httpConfig: {
        apiUrl: 'http://localhost',
        apiToken: 'test',
        agentId: 'test-id',
        agentIdentifier: 'test',
        agentName: 'Test',
      },
    };

    const middleware = provider.createMiddleware(
      mockTracer as never,
      mockAgentManager as never,
      mockConfig as never
    );

    expect(middleware).toHaveProperty('tracedQuery');
    expect(typeof middleware.tracedQuery).toBe('function');
  });

  test('shutdown is safe to call multiple times', () => {
    const provider = new PrefactorClaude();
    // Should not throw
    provider.shutdown();
    provider.shutdown();
  });
});
