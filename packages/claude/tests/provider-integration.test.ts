import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { getClient, init, PrefactorFatalError } from '@prefactor/core';
import { PrefactorClaude } from '../src/provider.js';

function createMockQueryStream(messages: SDKMessage[]): Query {
  const iterator = async function* () {
    for (const message of messages) {
      yield message;
    }
  };

  const generator = iterator();

  return {
    [Symbol.asyncIterator]: () => generator,
    next: generator.next.bind(generator),
    return: generator.return.bind(generator),
    throw: generator.throw.bind(generator),
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
  };
}

async function drainQuery(query: Query): Promise<void> {
  for await (const _message of query) {
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error('Condition was not met in time');
}

describe('PrefactorClaude provider integration', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await getClient()?.shutdown();
  });

  test('routes fatal transport failures through core failureHandling once', async () => {
    const fatalErrors: PrefactorFatalError[] = [];
    const queryFn = (() =>
      createMockQueryStream([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'session-1',
          model: 'claude-sonnet',
        } as SDKMessage,
        {
          type: 'result',
          subtype: 'end_turn',
          result: 'done',
          is_error: false,
        } as SDKMessage,
      ])) as typeof import('@anthropic-ai/claude-agent-sdk').query;

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'bad token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

    const prefactor = init({
      provider: new PrefactorClaude({ query: queryFn }),
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'token',
        agentIdentifier: 'claude-test',
      },
      failureHandling: {
        onFatalError: (error) => {
          fatalErrors.push(error);
        },
      },
    });

    const { tracedQuery } = prefactor.getMiddleware();

    await drainQuery(tracedQuery({ prompt: 'first run' }));
    await waitFor(() => fatalErrors.length === 1);

    expect(fatalErrors[0]).toBeInstanceOf(PrefactorFatalError);
    expect(fatalErrors[0]?.kind).toBe('auth');
    expect(fatalErrors[0]?.operation).toBe('agent_start');

    await drainQuery(tracedQuery({ prompt: 'second run' }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(fatalErrors).toHaveLength(1);
  });
});
