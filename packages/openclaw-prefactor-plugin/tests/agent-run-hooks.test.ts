import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import register from '../src/index.js';

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

const originalFetch = globalThis.fetch;
let createdSpanSchemas: string[] = [];

function registerWithFakeApi(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const api = {
    pluginConfig: {
      apiUrl: 'http://prefactor.test',
      apiToken: 'test-token',
      agentId: 'test-agent',
      logLevel: 'error',
    },
    version: 'test',
    on: (hookName: string, handler: Handler) => {
      handlers.set(hookName, handler);
    },
  };
  register(api as never);
  return handlers;
}

function fire(handlers: Map<string, Handler>, hookName: string, event: Record<string, unknown>) {
  const handler = handlers.get(hookName);
  if (!handler) {
    throw new Error(`hook ${hookName} was not registered`);
  }
  handler(event, { sessionKey: 'session-1', channelId: 'channel-1' });
}

async function waitForSpans(count: number): Promise<void> {
  const deadline = Date.now() + 2000;
  while (createdSpanSchemas.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // Give a duplicate span time to arrive if one is queued.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('agent run start hooks', () => {
  beforeEach(() => {
    createdSpanSchemas = [];
    let nextId = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/agent_spans') && init?.body) {
        const body = JSON.parse(String(init.body)) as { details?: { schema_name?: string } };
        createdSpanSchemas.push(body.details?.schema_name ?? 'unknown');
      }
      nextId += 1;
      return new Response(JSON.stringify({ details: { id: `id-${nextId}` } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('before_prompt_build starts the user message and agent run spans', async () => {
    const handlers = registerWithFakeApi();

    fire(handlers, 'message_received', { from: 'user-1', content: 'hello' });
    fire(handlers, 'before_prompt_build', { prompt: 'hello', messages: [] });
    await waitForSpans(4);

    expect(createdSpanSchemas.filter((s) => s === 'openclaw:user_message')).toHaveLength(1);
    expect(createdSpanSchemas.filter((s) => s === 'openclaw:agent_run')).toHaveLength(1);
  });

  test('OpenClaw versions firing both start hooks still get one span of each', async () => {
    const handlers = registerWithFakeApi();

    fire(handlers, 'message_received', { from: 'user-1', content: 'hello' });
    fire(handlers, 'before_agent_start', { messages: [] });
    fire(handlers, 'before_prompt_build', { prompt: 'hello', messages: [] });
    await waitForSpans(4);

    expect(createdSpanSchemas.filter((s) => s === 'openclaw:user_message')).toHaveLength(1);
    expect(createdSpanSchemas.filter((s) => s === 'openclaw:agent_run')).toHaveLength(1);
  });

  test('agent_end right after both start hooks does not leave a second agent run open', async () => {
    const handlers = registerWithFakeApi();

    fire(handlers, 'message_received', { from: 'user-1', content: 'hello' });
    fire(handlers, 'before_agent_start', { messages: [] });
    fire(handlers, 'before_prompt_build', { prompt: 'hello', messages: [] });
    fire(handlers, 'agent_end', { success: true, messages: [] });
    await waitForSpans(4);

    expect(createdSpanSchemas.filter((s) => s === 'openclaw:agent_run')).toHaveLength(1);
  });
});
