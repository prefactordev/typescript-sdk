import { describe, expect, test } from 'bun:test';
import type { Agent } from '../src/agent.js';
import { createLogger } from '../src/logger.js';
import { createSessionStateManager } from '../src/session-state.js';

function makeMockAgent() {
  const createSpanCalls: Array<{ schema: string; payload: Record<string, unknown> }> = [];

  const agent = {
    _calls: createSpanCalls,
    resolveToolSpanType: (_toolName: string) => 'openclaw:tool' as const,
    createSpan: async (
      _sessionKey: string,
      schema: string,
      payload: Record<string, unknown>,
      _parentSpanId?: string | null
    ): Promise<string | null> => {
      createSpanCalls.push({ schema, payload });
      return `span-${createSpanCalls.length}`;
    },
    finishSpan: async (): Promise<void> => {},
    finishAgentInstance: async (): Promise<void> => {},
    flushQueue: async (): Promise<void> => {},
    stop: (): void => {},
    emergencyCleanup: async (): Promise<void> => {},
  };

  return agent as unknown as Agent & { _calls: typeof createSpanCalls };
}

describe('token usage flow', () => {
  describe('createAssistantResponseSpan', () => {
    test('passes all five token fields to span payload', async () => {
      const mockAgent = makeMockAgent();
      const logger = createLogger('error');
      const manager = createSessionStateManager(mockAgent, logger);

      const tokens = {
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheWrite: 5,
        total: 165,
      };

      await manager.createAssistantResponseSpan('sess-1', 'Hello world', tokens);

      const call = mockAgent._calls.find(c => c.schema === 'openclaw:assistant_response');
      expect(call).toBeDefined();
      expect(call?.payload.tokens).toEqual(tokens);
    });

    test('omits tokens key when tokens is undefined', async () => {
      const mockAgent = makeMockAgent();
      const logger = createLogger('error');
      const manager = createSessionStateManager(mockAgent, logger);

      await manager.createAssistantResponseSpan('sess-2', 'Hello world', undefined);

      const call = mockAgent._calls.find(c => c.schema === 'openclaw:assistant_response');
      expect(call).toBeDefined();
      expect(call?.payload).not.toHaveProperty('tokens');
    });

    test('passes partial token fields without error', async () => {
      const mockAgent = makeMockAgent();
      const logger = createLogger('error');
      const manager = createSessionStateManager(mockAgent, logger);

      const tokens = { input: 80, output: 40 };

      await manager.createAssistantResponseSpan('sess-3', 'Hello world', tokens);

      const call = mockAgent._calls.find(c => c.schema === 'openclaw:assistant_response');
      expect(call?.payload.tokens).toEqual(tokens);
    });
  });

  describe('createAgentThinkingSpan', () => {
    test('passes all five token fields to span payload', async () => {
      const mockAgent = makeMockAgent();
      const logger = createLogger('error');
      const manager = createSessionStateManager(mockAgent, logger);

      const tokens = {
        input: 200,
        output: 80,
        cacheRead: 20,
        cacheWrite: 8,
        total: 308,
      };

      await manager.createAgentThinkingSpan('sess-4', '<thinking>...</thinking>', tokens);

      const call = mockAgent._calls.find(c => c.schema === 'openclaw:agent_thinking');
      expect(call).toBeDefined();
      expect(call?.payload.tokens).toEqual(tokens);
    });

    test('omits tokens key when tokens is undefined', async () => {
      const mockAgent = makeMockAgent();
      const logger = createLogger('error');
      const manager = createSessionStateManager(mockAgent, logger);

      await manager.createAgentThinkingSpan('sess-5', '<thinking>...</thinking>', undefined);

      const call = mockAgent._calls.find(c => c.schema === 'openclaw:agent_thinking');
      expect(call).toBeDefined();
      expect(call?.payload).not.toHaveProperty('tokens');
    });
  });
});
