import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { VERSION as PI_VERSION } from '@earendil-works/pi-coding-agent';
import { prefactorExtension, resetSetupNoticeForTests } from '../src/extension.js';
import { createContext, createPi, isolateEnvironment } from './helpers.js';

type SentRequest = { url: string; body: Record<string, unknown> | null };

function assistantMessage(content: unknown[], stopReason: string) {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet',
    usage: {
      input: 100,
      output: 20,
      cacheRead: 40,
      cacheWrite: 10,
      totalTokens: 170,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
    },
    stopReason,
    timestamp: 1_000,
    durationMs: 250,
  };
}

describe('prefactorExtension', () => {
  let restoreEnvironment: () => void;
  let requests: SentRequest[];
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    restoreEnvironment = isolateEnvironment().restore;
    resetSetupNoticeForTests();

    requests = [];
    let nextId = 0;
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      requests.push({ url: String(input), body });
      nextId += 1;
      return new Response(JSON.stringify({ details: { id: `id-${nextId}` } }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    restoreEnvironment();
  });

  const spans = () =>
    requests
      .filter((request) => request.url.endsWith('/api/v1/agent_spans'))
      .map((request) => request.body?.details as Record<string, unknown>);
  const spanId = (schemaName: string) =>
    `id-${requests.findIndex((request) => (request.body?.details as { schema_name?: string })?.schema_name === schemaName) + 1}`;

  test('records a session, its runs, LLM responses and tool calls with explicit parents', async () => {
    const { pi, emit } = createPi();
    prefactorExtension({
      apiUrl: 'https://prefactor.example',
      apiToken: 'token',
      agentId: 'agent-1',
    })(pi as never);
    const ctx = createContext({ hasUI: true });

    await emit({ type: 'session_start', reason: 'startup' }, ctx);
    await emit({ type: 'before_agent_start', messageType: 'user', prompt: 'fix the bug' }, ctx);
    await emit({ type: 'agent_start' }, ctx);
    await emit({ type: 'context', messages: [{ role: 'user', content: 'fix the bug' }] }, ctx);
    await emit(
      {
        type: 'message_end',
        message: assistantMessage([{ type: 'toolCall', id: 'call-1', name: 'bash' }], 'toolUse'),
      },
      ctx
    );
    await emit(
      {
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'ls' },
      },
      ctx
    );
    await emit(
      {
        type: 'tool_execution_start',
        toolCallId: 'call-2',
        toolName: 'custom_tool',
        args: {},
        parentToolCallId: 'call-1',
      },
      ctx
    );
    await emit(
      {
        type: 'tool_execution_end',
        toolCallId: 'call-2',
        result: { content: [{ type: 'text', text: 'nested' }] },
        isError: true,
      },
      ctx
    );
    await emit(
      {
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        result: { content: [{ type: 'text', text: 'a.ts' }], details: { exit_code: 0 } },
        isError: false,
        durationMs: 12,
      },
      ctx
    );
    await emit({ type: 'message_end', message: { role: 'user', content: 'ignored' } }, ctx);
    await emit(
      {
        type: 'message_end',
        message: assistantMessage([{ type: 'text', text: 'Fixed.' }], 'stop'),
      },
      ctx
    );
    await emit({ type: 'agent_end', messages: [] }, ctx);
    await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);

    expect(requests[0].url).toBe('https://prefactor.example/api/v1/agent_instance/register');
    expect(requests[0].body).toMatchObject({
      agent_id: 'agent-1',
      agent_version: { external_identifier: PI_VERSION, name: 'pi' },
    });
    expect(requests.at(-1)?.url).toMatch(/\/api\/v1\/agent_instance\/id-1\/finish$/);

    const created = spans();
    expect(created.map((span) => span.schema_name)).toEqual([
      'pi:session',
      'pi:agent_run',
      'pi:llm',
      'pi:tool:bash',
      'pi:tool',
      'pi:llm',
    ]);
    const [session, run, firstLlm, bash, nested, secondLlm] = created;
    expect(session).toMatchObject({
      status: 'active',
      parent_span_id: null,
      payload: { session_id: 'session-1', cwd: '/work/repo', mode: 'tui', reason: 'startup' },
    });
    expect(run).toMatchObject({
      parent_span_id: spanId('pi:session'),
      payload: { prompt: 'fix the bug' },
    });
    expect(firstLlm).toMatchObject({
      status: 'complete',
      parent_span_id: spanId('pi:agent_run'),
      payload: { provider: 'anthropic', model: 'claude-sonnet', messages: [{ role: 'user' }] },
      result_payload: {
        stop_reason: 'toolUse',
        usage: { input: 100, output: 20, cache_read: 40, cache_write: 10, total: 170 },
        cost: { cache_read: 0.01, cache_write: 0.02, total: 0.33 },
        duration_ms: 250,
      },
      started_at: new Date(1_000).toISOString(),
      finished_at: new Date(1_250).toISOString(),
    });
    expect(bash).toMatchObject({
      parent_span_id: spanId('pi:agent_run'),
      payload: { tool_name: 'bash', tool_call_id: 'call-1', input: { command: 'ls' } },
    });
    expect(nested).toMatchObject({
      parent_span_id: spanId('pi:tool:bash'),
      payload: { tool_name: 'custom_tool', parent_tool_call_id: 'call-1' },
    });
    expect(secondLlm.payload).toMatchObject({ messages: [] });

    const finishes = requests
      .filter((request) => request.url.endsWith('/finish') && request.url.includes('agent_spans'))
      .map((request) => ({ url: request.url, body: request.body }));
    expect(finishes.find((f) => f.url.includes(`/${spanId('pi:tool')}/`))?.body).toMatchObject({
      status: 'failed',
      result_payload: { is_error: true },
    });
    expect(finishes.find((f) => f.url.includes(`/${spanId('pi:tool:bash')}/`))?.body).toMatchObject(
      {
        status: 'complete',
        result_payload: { details: { exit_code: 0 }, duration_ms: 12 },
      }
    );
    expect(finishes.find((f) => f.url.includes(`/${spanId('pi:agent_run')}/`))?.body).toMatchObject(
      {
        status: 'complete',
        result_payload: { response: 'Fixed.', stop_reason: 'stop' },
      }
    );
    expect(finishes.at(-1)).toMatchObject({
      url: expect.stringContaining(`/${spanId('pi:session')}/`),
      body: { status: 'complete', result_payload: { reason: 'quit' } },
    });
  });

  test('records the whole context when it no longer extends the context already recorded', async () => {
    const { pi, emit } = createPi();
    prefactorExtension({ apiUrl: 'https://prefactor.example', apiToken: 't', agentId: 'a' })(
      pi as never
    );
    const ctx = createContext({ hasUI: false });
    const reply = assistantMessage([{ type: 'text', text: 'ok' }], 'stop');

    await emit({ type: 'session_start', reason: 'startup' }, ctx);
    await emit({ type: 'agent_start' }, ctx);
    await emit({ type: 'context', messages: [{ role: 'user', content: 'one' }] }, ctx);
    await emit({ type: 'message_end', message: reply }, ctx);
    await emit(
      {
        type: 'context',
        messages: [{ role: 'user', content: 'one' }, reply, { role: 'user', content: 'two' }],
      },
      ctx
    );
    await emit({ type: 'message_end', message: reply }, ctx);
    await emit(
      {
        type: 'context',
        messages: [{ role: 'user', content: 'three' }, reply, { role: 'user', content: 'four' }],
      },
      ctx
    );
    await emit({ type: 'message_end', message: reply }, ctx);
    await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);

    const recorded = spans()
      .filter((span) => span.schema_name === 'pi:llm')
      .map((span) => (span.payload as { messages: Array<{ content: unknown }> }).messages);
    expect(recorded.map((messages) => messages.map((message) => message.content))).toEqual([
      ['one'],
      [[{ type: 'text', text: 'ok' }], 'two'],
      ['three', [{ type: 'text', text: 'ok' }], 'four'],
    ]);
  });

  test('sends nothing when the configuration is invalid', async () => {
    process.env.PREFACTOR_MAX_INPUT_LENGTH = '0';
    try {
      const { pi, emit } = createPi();
      prefactorExtension({ apiUrl: 'https://prefactor.example', apiToken: 't', agentId: 'a' })(
        pi as never
      );
      const ctx = createContext({ hasUI: false });
      await emit({ type: 'session_start', reason: 'startup' }, ctx);
      await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      delete process.env.PREFACTOR_MAX_INPUT_LENGTH;
    }

    expect(requests).toEqual([]);
  });

  test('records the agent version given in the options instead of the pi version', async () => {
    const { pi, emit } = createPi();
    prefactorExtension({
      apiUrl: 'https://prefactor.example',
      apiToken: 'token',
      agentId: 'agent-1',
      agentVersion: '2.3.0',
    })(pi as never);
    const ctx = createContext({ hasUI: false });

    await emit({ type: 'session_start', reason: 'startup' }, ctx);
    await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);

    expect(requests[0].body).toMatchObject({ agent_version: { external_identifier: '2.3.0' } });
  });

  test('records nothing and shows the setup notice once when no token is found', async () => {
    const ctx = createContext({ hasUI: true });
    for (let index = 0; index < 2; index += 1) {
      const { pi, emit } = createPi();
      prefactorExtension()(pi as never);
      await emit({ type: 'session_start', reason: 'startup' }, ctx);
      await emit({ type: 'agent_start' }, ctx);
      await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);
    }

    expect(requests).toEqual([]);
    expect(ctx.notifications).toHaveLength(1);
    expect(ctx.notifications[0]).toBe(
      'Prefactor is not set up. Run /prefactor setup to connect pi to Prefactor.'
    );
  });

  test('writes notices to stderr when pi has no UI', async () => {
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { pi, emit } = createPi();
      prefactorExtension()(pi as never);
      await emit({ type: 'session_start', reason: 'startup' }, createContext({ hasUI: false }));
      expect(String(stderr.mock.calls[0]?.[0])).toContain('PREFACTOR_API_TOKEN');
    } finally {
      stderr.mockRestore();
    }
  });
});
