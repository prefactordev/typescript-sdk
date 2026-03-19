import { describe, expect, test } from 'bun:test';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_CLAUDE_AGENT_SCHEMA, PrefactorClaude } from '../src/index.js';

describe('PrefactorClaude', () => {
  const mockQuery = (() => ({}) as Query) as typeof import('@anthropic-ai/claude-agent-sdk').query;

  test('getDefaultAgentSchema returns DEFAULT_CLAUDE_AGENT_SCHEMA', () => {
    const provider = new PrefactorClaude({ query: mockQuery });
    expect(provider.getDefaultAgentSchema()).toEqual(DEFAULT_CLAUDE_AGENT_SCHEMA);
  });

  test('normalizeAgentSchema extracts tool span types', () => {
    const provider = new PrefactorClaude({ query: mockQuery });
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
    const provider = new PrefactorClaude({ query: mockQuery });

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

  test('createMiddleware resolves tool span types from normalized config schema', async () => {
    const queryCalls: Array<Parameters<typeof mockQuery>[0]> = [];
    const startedSpans: Array<{ spanType: string; inputs: Record<string, unknown> }> = [];
    const queryFn = ((params) => {
      queryCalls.push(params);
      return {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'session-1',
            model: 'claude-sonnet',
          };
          yield {
            type: 'result',
            result: 'done',
            subtype: 'end_turn',
            is_error: false,
          };
        },
        next: async () => ({ done: true, value: undefined }),
        return: async () => ({ done: true, value: undefined }),
        throw: async (error?: unknown) => {
          throw error;
        },
        interrupt: async () => {},
        setPermissionMode: async () => {},
        setModel: async () => {},
        setMaxThinkingTokens: async () => {},
        applyFlagSettings: async () => {},
        initializationResult: async () => ({}) as never,
        supportedCommands: async () => [],
        supportedModels: async () => [],
        supportedAgents: async () => [],
        mcpServerStatus: async () => [],
        accountInfo: async () => ({}) as never,
        rewindFiles: async () => ({ canRewind: false }),
        reconnectMcpServer: async () => {},
        toggleMcpServer: async () => {},
        setMcpServers: async () => ({ added: [], removed: [], errors: [] }),
        streamInput: async () => {},
        stopTask: async () => {},
        close: () => {},
      } as Query;
    }) as typeof mockQuery;

    const provider = new PrefactorClaude({ query: queryFn });
    const schemaA = provider.normalizeAgentSchema({
      ...DEFAULT_CLAUDE_AGENT_SCHEMA,
      toolSchemas: {
        Read: {
          spanType: 'claude:tool:read',
          inputSchema: { type: 'object' },
        },
      },
    });

    const mockTracer = {
      startSpan: (options: { spanType: string; inputs: Record<string, unknown> }) => {
        startedSpans.push({ spanType: options.spanType, inputs: options.inputs });
        return {};
      },
      endSpan: () => {},
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    };

    const mockAgentManager = {
      startInstance: () => {},
      finishInstance: () => {},
    };

    const clonedSchema = JSON.parse(JSON.stringify(schemaA)) as typeof schemaA;

    const middleware = provider.createMiddleware(
      mockTracer as never,
      mockAgentManager as never,
      {
        httpConfig: {
          apiUrl: 'http://localhost',
          apiToken: 'test',
          agentIdentifier: 'claude-test',
          agentSchema: clonedSchema,
        },
      } as never
    );

    for await (const _message of middleware.tracedQuery({ prompt: 'test' })) {
      break;
    }

    const hooks = queryCalls[0]?.options?.hooks;
    const preToolUse = hooks?.PreToolUse?.[0]?.hooks?.[0];
    expect(preToolUse).toBeDefined();
    await preToolUse?.({ tool_name: 'Read', tool_input: { file_path: '/tmp/foo.ts' } }, 'tool-1', {
      signal: new AbortController().signal,
    });
    expect(startedSpans).toContainEqual({
      spanType: 'claude:tool:read',
      inputs: {
        'claude.tool.name': 'Read',
        toolName: 'Read',
        toolUseId: 'tool-1',
        input: { file_path: '/tmp/foo.ts' },
      },
    });
  });

  test('shutdown is safe to call multiple times', () => {
    const provider = new PrefactorClaude({ query: mockQuery });
    // Should not throw
    provider.shutdown();
    provider.shutdown();
  });
});
