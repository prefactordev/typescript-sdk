import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { VERSION as PI_VERSION } from '@earendil-works/pi-coding-agent';
import type { SpanTypeSchema } from '@prefactor/core';
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
  const finishOf = (id: string) =>
    requests.find((request) => request.url.endsWith(`/agent_spans/${id}/finish`))?.body;
  const spanIdAt = (index: number) =>
    `id-${requests.findIndex((request) => request.body?.details === spans()[index]) + 1}`;

  const user = (text: string) => ({
    type: 'message_end',
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: 0 },
  });

  test('records a session as a conversation of canonical agent spans', async () => {
    const { pi, emit } = createPi();
    prefactorExtension({
      apiUrl: 'https://prefactor.example',
      apiToken: 'token',
      agentId: 'agent-1',
    })(pi as never);
    const ctx = createContext({ hasUI: true });

    await emit({ type: 'session_start', reason: 'startup' }, ctx);
    await emit({ type: 'agent_start' }, ctx);
    await emit(user('fix the bug'), ctx);
    await emit(
      {
        type: 'message_end',
        message: assistantMessage(
          [
            { type: 'thinking', thinking: 'Look first.' },
            { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'ls' } },
          ],
          'toolUse'
        ),
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
        result: { content: [{ type: 'text', text: 'nested failure' }] },
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
      },
      ctx
    );
    await emit({ type: 'message_end', message: { role: 'toolResult', content: [] } }, ctx);
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
      '$agent:system_message',
      '$agent:user_turn',
      '$agent:user_message',
      '$agent:assistant_turn',
      '$agent:llm_call',
      '$agent:assistant_thinking',
      '$agent:tool:bash',
      '$agent:tool:pi:other',
      '$agent:llm_call',
      '$agent:assistant_message',
    ]);
    const [
      session,
      system,
      userTurn,
      userMessage,
      assistantTurn,
      firstLlm,
      thinking,
      bash,
      nested,
      secondLlm,
      reply,
    ] = created;
    const sessionId = spanIdAt(0);
    const userTurnId = spanIdAt(2);
    const assistantTurnId = spanIdAt(4);
    const bashId = spanIdAt(7);

    expect(session).toMatchObject({
      status: 'active',
      parent_span_id: null,
      payload: { session_id: 'session-1', cwd: '/work/repo', mode: 'tui', reason: 'startup' },
    });
    expect(system).toMatchObject({
      status: 'complete',
      parent_span_id: sessionId,
      payload: { _version: 1, text: 'You are pi.' },
    });
    expect(userTurn).toMatchObject({
      status: 'complete',
      parent_span_id: sessionId,
      payload: { _version: 1, turn: 1 },
    });
    expect(userMessage).toMatchObject({
      parent_span_id: userTurnId,
      payload: { _version: 1, text: 'fix the bug' },
    });
    expect(assistantTurn).toMatchObject({
      status: 'active',
      parent_span_id: sessionId,
      payload: { _version: 1 },
    });
    expect(firstLlm).toMatchObject({
      status: 'complete',
      parent_span_id: assistantTurnId,
      payload: {
        _version: 1,
        request: { model: 'claude-sonnet', provider_name: 'anthropic', api: 'anthropic-messages' },
      },
      result_payload: {
        _version: 1,
        response: {
          model: 'claude-sonnet',
          provider_name: 'anthropic',
          stop_reason: 'toolUse',
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 40,
            cache_creation_input_tokens: 10,
            total_tokens: 170,
          },
          cost: { cache_read: 0.01, cache_write: 0.02, total: 0.33 },
        },
      },
    });
    expect(thinking).toMatchObject({
      parent_span_id: assistantTurnId,
      payload: { type: 'transparent', text: 'Look first.' },
    });
    expect(bash).toMatchObject({
      parent_span_id: assistantTurnId,
      payload: { _version: 1, tool_use_id: 'call-1', params: { command: 'ls' } },
    });
    expect(bash.payload).not.toHaveProperty('tool_name');
    expect(nested).toMatchObject({
      parent_span_id: bashId,
      payload: { tool_use_id: 'call-2', tool_name: 'custom_tool' },
    });
    expect(secondLlm.parent_span_id).toBe(assistantTurnId);
    expect(reply).toMatchObject({
      parent_span_id: assistantTurnId,
      payload: { _version: 1, text: 'Fixed.' },
    });

    const startTimes = created.map((span) => Date.parse(String(span.started_at)));
    expect(startTimes).toEqual([...startTimes].sort((a, b) => a - b));
    expect(new Set(startTimes).size).toBe(startTimes.length);

    expect(finishOf(spanIdAt(8))).toMatchObject({
      status: 'failed',
      result_payload: { _version: 1, error: 'nested failure' },
    });
    expect(finishOf(bashId)).toMatchObject({
      status: 'complete',
      result_payload: {
        _version: 1,
        result: { content: [{ type: 'text', text: 'a.ts' }], details: { exit_code: 0 } },
      },
    });
    expect(finishOf(assistantTurnId)).toMatchObject({
      status: 'complete',
      result_payload: {
        _version: 1,
        stop_reason: 'stop',
        usage: {
          input_tokens: 200,
          output_tokens: 40,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: 20,
          total_tokens: 340,
        },
      },
    });
    expect(finishOf(sessionId)).toMatchObject({
      status: 'complete',
      result_payload: { reason: 'quit' },
    });
  });

  test('registers a span type for each tool pi has at session start, and a fallback', async () => {
    const { pi, emit } = createPi({
      tools: [
        { name: 'bash', description: 'Run a command' },
        { name: 'search_docs', description: 'Search the docs' },
      ],
    });
    prefactorExtension({ apiUrl: 'https://prefactor.example', apiToken: 't', agentId: 'a' })(
      pi as never
    );
    const ctx = createContext({ hasUI: false });
    await emit({ type: 'session_start', reason: 'startup' }, ctx);
    await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);

    const schemas = (
      requests[0].body as { agent_schema_version: { span_type_schemas: SpanTypeSchema[] } }
    ).agent_schema_version.span_type_schemas;
    const toolSchemas = schemas.filter((schema) => schema.name.startsWith('$agent:tool:'));
    expect(toolSchemas.map((schema) => [schema.name, schema.title])).toEqual([
      ['$agent:tool:bash', 'bash'],
      ['$agent:tool:search_docs', 'search_docs'],
      ['$agent:tool:pi:other', 'Other tool'],
    ]);
    expect(toolSchemas[1].description).toBe('Search the docs');
    expect(schemas.map((schema) => schema.name)).not.toContain('pi:agent_run');
  });

  test('starts a user turn for each steering message and closes the assistant turn at run end', async () => {
    const { pi, emit } = createPi();
    prefactorExtension({ apiUrl: 'https://prefactor.example', apiToken: 't', agentId: 'a' })(
      pi as never
    );
    const ctx = createContext({ hasUI: false });
    const reply = (stopReason: string) => ({
      type: 'message_end',
      message: assistantMessage([{ type: 'text', text: 'ok' }], stopReason),
    });

    await emit({ type: 'session_start', reason: 'startup' }, ctx);
    await emit({ type: 'agent_start' }, ctx);
    await emit(user('one'), ctx);
    await emit(reply('toolUse'), ctx);
    await emit(user('steer'), ctx);
    await emit(reply('stop'), ctx);
    await emit({ type: 'agent_end', messages: [] }, ctx);
    await emit({ type: 'agent_start' }, ctx);
    await emit(user('two'), ctx);
    await emit(reply('error'), ctx);
    await emit({ type: 'agent_end', messages: [] }, ctx);
    ctx.systemPrompt = 'You are pi, with a skill.';
    await emit({ type: 'agent_start' }, ctx);
    await emit(user('three'), ctx);
    await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);

    const created = spans();
    expect(created.map((span) => span.schema_name)).toEqual([
      'pi:session',
      '$agent:system_message',
      '$agent:user_turn',
      '$agent:user_message',
      '$agent:assistant_turn',
      '$agent:llm_call',
      '$agent:assistant_message',
      '$agent:user_turn',
      '$agent:user_message',
      '$agent:assistant_turn',
      '$agent:llm_call',
      '$agent:assistant_message',
      '$agent:user_turn',
      '$agent:user_message',
      '$agent:assistant_turn',
      '$agent:llm_call',
      '$agent:assistant_message',
      '$agent:system_message',
      '$agent:user_turn',
      '$agent:user_message',
    ]);
    expect(
      created
        .filter((span) => span.schema_name === '$agent:user_turn')
        .map((span) => (span.payload as { turn: number }).turn)
    ).toEqual([1, 2, 3, 4]);
    expect(created[17].payload).toMatchObject({ text: 'You are pi, with a skill.' });

    const turnFinishes = [4, 9, 14].map((index) => finishOf(spanIdAt(index)));
    expect(turnFinishes).toMatchObject([
      { status: 'complete', result_payload: { stop_reason: 'toolUse' } },
      { status: 'complete', result_payload: { stop_reason: 'stop' } },
      { status: 'failed', result_payload: { stop_reason: 'error' } },
    ]);
    expect(finishOf(spanIdAt(14))).toMatchObject({
      result_payload: { usage: { total_tokens: 170 } },
    });
    expect(created[15]).toMatchObject({
      status: 'failed',
      result_payload: { error: 'The model call failed.' },
    });
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
