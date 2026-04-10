import { beforeEach, describe, expect, test } from 'bun:test';
import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  Query,
  SDKMessage,
  StopHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { type Span, SpanStatus, type Tracer } from '@prefactor/core';
import { createInstrumentationHooks, finalizeAgentSpan, mergeHooks } from '../src/hooks.js';
import { createClaudeRuntimeController, createTracedQuery } from '../src/traced-query.js';
import type { ClaudeQuery, TracedQueryState } from '../src/types.js';

type HooksMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

let spanCounter = 0;

function createSpan(spanType: string, inputs: Record<string, unknown>, name: string): Span {
  spanCounter += 1;
  return {
    spanId: `span-${spanCounter}`,
    parentSpanId: null,
    traceId: `trace-${spanCounter}`,
    name,
    spanType,
    startTime: Date.now(),
    endTime: null,
    status: SpanStatus.RUNNING,
    inputs,
    outputs: null,
    tokenUsage: null,
    error: null,
    metadata: {},
  };
}

interface EndedEntry {
  span: Span;
  outputs?: Record<string, unknown>;
  error?: Error;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

function createMockTracer() {
  const started: Array<{ name: string; spanType: string; inputs: Record<string, unknown> }> = [];
  const ended: EndedEntry[] = [];

  const tracer: Tracer = {
    startSpan: (options) => {
      started.push({ name: options.name, spanType: options.spanType, inputs: options.inputs });
      return createSpan(options.spanType, options.inputs, options.name);
    },
    endSpan: (span, options) => {
      ended.push({
        span,
        outputs: options?.outputs as Record<string, unknown> | undefined,
        error: options?.error,
        tokenUsage: options?.tokenUsage,
      });
    },
    close: async () => {},
    startAgentInstance: () => {},
    finishAgentInstance: () => {},
  } as unknown as Tracer;

  return { tracer, started, ended };
}

function createState(): TracedQueryState {
  return {
    currentLlmSpan: null,
    currentLlmOutputs: {},
    agentSpan: null,
    agentSpanFinished: false,
    toolSpanMap: new Map(),
    subagentSpanMap: new Map(),
  };
}

function createMockQueryStream(overrides: Partial<Query> = {}): Query {
  const generator = async function* () {};

  return {
    [Symbol.asyncIterator]: generator,
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
    ...overrides,
  };
}

function createSequenceQueryStream(messages: SDKMessage[], overrides: Partial<Query> = {}): Query {
  const iterator = async function* () {
    for (const message of messages) {
      yield message;
    }
  };

  const generator = iterator();

  return createMockQueryStream({
    [Symbol.asyncIterator]: () => generator,
    next: generator.next.bind(generator),
    return: generator.return.bind(generator),
    throw: generator.throw.bind(generator),
    ...overrides,
  });
}

function createControlledQueryStream() {
  const queue: SDKMessage[] = [];
  let done = false;
  let error: unknown;
  let pendingResolve: (() => void) | null = null;

  const notify = () => {
    pendingResolve?.();
    pendingResolve = null;
  };

  const iterator = async function* () {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as SDKMessage;
        continue;
      }

      if (error) {
        throw error;
      }

      if (done) {
        return;
      }

      await new Promise<void>((resolve) => {
        pendingResolve = resolve;
      });
    }
  };

  const generator = iterator();
  return {
    stream: createMockQueryStream({
      [Symbol.asyncIterator]: () => generator,
      next: generator.next.bind(generator),
      return: generator.return.bind(generator),
      throw: generator.throw.bind(generator),
    }),
    push(message: SDKMessage) {
      queue.push(message);
      notify();
    },
    finish() {
      done = true;
      notify();
    },
    fail(nextError: unknown) {
      error = nextError;
      notify();
    },
  };
}

async function collectMessages(query: Query): Promise<SDKMessage[]> {
  const messages: SDKMessage[] = [];
  for await (const message of query) {
    messages.push(message);
  }
  return messages;
}

function getHook(hooks: HooksMap, event: HookEvent): HookCallback {
  const matchers = hooks[event];
  if (!matchers || matchers.length === 0) {
    throw new Error(`No hooks registered for ${event}`);
  }
  const hookList = matchers[0].hooks;
  if (!hookList || hookList.length === 0) {
    throw new Error(`No hook callbacks in first matcher for ${event}`);
  }
  return hookList[0];
}

const signal = new AbortController().signal;

describe('hooks', () => {
  let mock: ReturnType<typeof createMockTracer>;
  let state: TracedQueryState;

  beforeEach(() => {
    spanCounter = 0;
    mock = createMockTracer();
    state = createState();
  });

  test('PreToolUse creates a tool span in toolSpanMap', async () => {
    const hooks = createInstrumentationHooks(mock.tracer, undefined, state);
    const preToolUse = getHook(hooks, 'PreToolUse');

    await preToolUse({ tool_name: 'Read', tool_input: { file_path: '/foo.ts' } }, 'tool-use-1', {
      signal,
    });

    expect(state.toolSpanMap.size).toBe(1);
    expect(state.toolSpanMap.has('tool-use-1')).toBe(true);
    expect(mock.started[0]).toEqual({
      name: 'claude:tool-call',
      spanType: 'claude:tool',
      inputs: {
        'claude.tool.name': 'Read',
        toolName: 'Read',
        toolUseId: 'tool-use-1',
        input: { file_path: '/foo.ts' },
      },
    });
  });

  test('PostToolUse ends the tool span and removes it from the map', async () => {
    const hooks = createInstrumentationHooks(mock.tracer, undefined, state);
    await getHook(hooks, 'PreToolUse')(
      { tool_name: 'Read', tool_input: { file_path: '/foo.ts' } },
      'tool-use-1',
      { signal }
    );
    await getHook(hooks, 'PostToolUse')(
      { tool_name: 'Read', tool_response: 'file contents here' },
      'tool-use-1',
      { signal }
    );

    expect(state.toolSpanMap.size).toBe(0);
    expect(mock.ended).toHaveLength(1);
    expect(mock.ended[0].outputs).toEqual({ output: 'file contents here' });
  });

  test('Stop finalizes the agent span with stop metadata and clears in-flight spans', async () => {
    const hooks = createInstrumentationHooks(mock.tracer, undefined, state);
    state.agentSpan = createSpan('claude:agent', {}, 'claude:session');

    await getHook(hooks, 'PreToolUse')(
      { tool_name: 'Read', tool_input: { file_path: '/foo.ts' } },
      'tool-use-1',
      { signal }
    );
    await getHook(hooks, 'SubagentStart')(
      { agent_id: 'subagent-1', agent_type: 'reviewer' },
      undefined,
      { signal }
    );

    await getHook(hooks, 'Stop')(
      { last_assistant_message: 'Stopped by user' } as StopHookInput,
      undefined,
      { signal }
    );

    expect(state.agentSpanFinished).toBe(true);
    expect(state.toolSpanMap.size).toBe(0);
    expect(state.subagentSpanMap.size).toBe(0);
    expect(mock.ended).toHaveLength(3);
    expect(mock.ended[0]?.outputs).toEqual({
      'claude.finishReason': 'stopped',
      'claude.lastAssistantMessage': 'Stopped by user',
    });
    expect(mock.ended[1]?.error?.message).toBe('Agent stopped before span completed');
    expect(mock.ended[2]?.error?.message).toBe('Agent stopped before span completed');
  });
});

describe('finalizeAgentSpan', () => {
  test('ends agent span with outputs and token usage', () => {
    const mock = createMockTracer();
    const state = createState();
    state.agentSpan = createSpan('claude:agent', {}, 'claude:session');

    finalizeAgentSpan(
      state,
      mock.tracer,
      { result: 'done' },
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    );

    expect(state.agentSpanFinished).toBe(true);
    expect(mock.ended[0]?.outputs).toEqual({ result: 'done' });
    expect(mock.ended[0]?.tokenUsage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });
});

describe('mergeHooks', () => {
  test('returns instrumentation hooks when no user hooks', () => {
    const ours = { PreToolUse: [{ hooks: [async () => ({})] }] };
    expect(mergeHooks(ours as never, undefined)).toBe(ours);
  });

  test('orders pre-hooks before user hooks and post-hooks after user hooks', () => {
    const ourHook = async () => ({ id: 'ours' });
    const userHook = async () => ({ id: 'user' });

    const result = mergeHooks(
      {
        PreToolUse: [{ hooks: [ourHook] }],
        PostToolUse: [{ hooks: [ourHook] }],
      } as never,
      {
        PreToolUse: [{ hooks: [userHook] }],
        PostToolUse: [{ hooks: [userHook] }],
      } as never
    );

    expect(result.PreToolUse?.[0]?.hooks?.[0]).toBe(ourHook);
    expect(result.PreToolUse?.[1]?.hooks?.[0]).toBe(userHook);
    expect(result.PostToolUse?.[0]?.hooks?.[0]).toBe(userHook);
    expect(result.PostToolUse?.[1]?.hooks?.[0]).toBe(ourHook);
  });
});

describe('createTracedQuery', () => {
  test('calls the injected query function with merged hooks', () => {
    const mock = createMockTracer();
    const queryCalls: Array<Parameters<ClaudeQuery>[0]> = [];
    const middleware = createTracedQuery(
      ((params) => {
        queryCalls.push(params);
        return createMockQueryStream();
      }) as ClaudeQuery,
      mock.tracer,
      { startInstance: () => {}, finishInstance: () => {} } as never,
      { agentIdentifier: 'claude-test' },
      createClaudeRuntimeController()
    );

    const userPreToolUse = async () => ({ continue: true });
    const userPostToolUse = async () => ({ continue: true });

    middleware.tracedQuery({
      prompt: 'test prompt',
      options: {
        hooks: {
          PreToolUse: [{ hooks: [userPreToolUse] }],
          PostToolUse: [{ hooks: [userPostToolUse] }],
        },
      },
    });

    expect(queryCalls).toHaveLength(1);
    const hooks = queryCalls[0]?.options?.hooks;
    expect(hooks?.PreToolUse).toHaveLength(2);
    expect(hooks?.PostToolUse).toHaveLength(2);
    expect(hooks?.PreToolUse?.[0]?.hooks?.[0]).not.toBe(userPreToolUse);
    expect(hooks?.PreToolUse?.[1]?.hooks?.[0]).toBe(userPreToolUse);
    expect(hooks?.PostToolUse?.[0]?.hooks?.[0]).toBe(userPostToolUse);
    expect(hooks?.PostToolUse?.[1]?.hooks?.[0]).not.toBe(userPostToolUse);
  });

  test('rejects overlapping tracedQuery calls', () => {
    const controlled = createControlledQueryStream();
    const middleware = createTracedQuery(
      (() => controlled.stream) as ClaudeQuery,
      createMockTracer().tracer,
      { startInstance: () => {}, finishInstance: () => {} } as never,
      { agentIdentifier: 'claude-test' },
      createClaudeRuntimeController()
    );

    middleware.tracedQuery({ prompt: 'first' });

    expect(() => middleware.tracedQuery({ prompt: 'second' })).toThrow(
      'Prefactor Claude only supports one active tracedQuery() per middleware instance.'
    );

    controlled.finish();
  });

  test('allows a second run after the first run completes', async () => {
    const mock = createMockTracer();
    const agentManager = {
      startCalls: 0,
      finishCalls: 0,
      startInstance() {
        this.startCalls += 1;
      },
      finishInstance() {
        this.finishCalls += 1;
      },
    };

    const middleware = createTracedQuery(
      (() =>
        createSequenceQueryStream([
          {
            type: 'system',
            subtype: 'init',
            session_id: 'session-1',
            model: 'claude-sonnet',
          } as SDKMessage,
          { type: 'result', result: 'done', subtype: 'end_turn', is_error: false } as SDKMessage,
        ])) as ClaudeQuery,
      mock.tracer,
      agentManager as never,
      { agentIdentifier: 'claude-test' },
      createClaudeRuntimeController()
    );

    await collectMessages(middleware.tracedQuery({ prompt: 'first' }));
    await collectMessages(middleware.tracedQuery({ prompt: 'second' }));

    expect(agentManager.startCalls).toBe(2);
    expect(agentManager.finishCalls).toBe(2);
  });

  test('provider shutdown path can finish an active instance once and allow a new run', async () => {
    const controlled = createControlledQueryStream();
    const queryFn = (() => controlled.stream) as ClaudeQuery;
    const runtimeController = createClaudeRuntimeController();
    const agentManager = {
      startCalls: 0,
      finishCalls: 0,
      startInstance() {
        this.startCalls += 1;
      },
      finishInstance() {
        this.finishCalls += 1;
      },
    };
    const middleware = createTracedQuery(
      queryFn,
      createMockTracer().tracer,
      agentManager as never,
      { agentIdentifier: 'claude-test' },
      runtimeController
    );

    const query = middleware.tracedQuery({ prompt: 'first' });
    controlled.push({
      type: 'system',
      subtype: 'init',
      session_id: 'session-1',
      model: 'claude-sonnet',
    } as SDKMessage);
    await query.next();

    runtimeController.shutdown(agentManager as never);
    expect(agentManager.finishCalls).toBe(1);

    controlled.finish();
    await collectMessages(query);

    await collectMessages(middleware.tracedQuery({ prompt: 'second' }));
  });

  test('releases the active run when iteration is interrupted via return()', async () => {
    const mock = createMockTracer();
    const controlled = createControlledQueryStream();
    const middleware = createTracedQuery(
      (() => controlled.stream) as ClaudeQuery,
      mock.tracer,
      { startInstance: () => {}, finishInstance: () => {} } as never,
      { agentIdentifier: 'claude-test' },
      createClaudeRuntimeController()
    );

    const query = middleware.tracedQuery({ prompt: 'first' });
    controlled.push({
      type: 'system',
      subtype: 'init',
      session_id: 'session-1',
      model: 'claude-sonnet',
    } as SDKMessage);
    await query.next();
    await query.return();

    const agentEnd = mock.ended.find((entry) => entry.span.spanType === 'claude:agent');
    expect(agentEnd?.outputs).toEqual({
      'claude.finishReason': 'interrupted',
    });
    expect(() => middleware.tracedQuery({ prompt: 'second' })).not.toThrow();
    controlled.finish();
  });

  test('forwards query control methods to the underlying stream', async () => {
    const calls: string[] = [];
    const middleware = createTracedQuery(
      (() =>
        createMockQueryStream({
          accountInfo: async () => {
            calls.push('accountInfo');
            return { email: 'test@test.com' } as never;
          },
          supportedModels: async () => {
            calls.push('supportedModels');
            return [] as never;
          },
        })) as ClaudeQuery,
      createMockTracer().tracer,
      { startInstance: () => {}, finishInstance: () => {} } as never,
      { agentIdentifier: 'claude-test' },
      createClaudeRuntimeController()
    );

    const wrapped = middleware.tracedQuery({ prompt: 'test' });
    await wrapped.accountInfo();
    await wrapped.supportedModels();

    expect(calls).toEqual(['accountInfo', 'supportedModels']);
    expect(typeof wrapped.interrupt).toBe('function');
    expect(typeof wrapped.close).toBe('function');
  });

  test('captures assistant content and closes the final llm span on result', async () => {
    const mock = createMockTracer();
    const middleware = createTracedQuery(
      (() =>
        createSequenceQueryStream([
          {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Final answer', formatter: () => 'x' }] },
          } as SDKMessage,
          { type: 'result', result: 'done', subtype: 'end_turn', is_error: false } as SDKMessage,
        ])) as ClaudeQuery,
      mock.tracer,
      { startInstance: () => {}, finishInstance: () => {} } as never,
      { agentIdentifier: 'claude-test' },
      createClaudeRuntimeController()
    );

    await collectMessages(middleware.tracedQuery({ prompt: 'test' }));

    expect(mock.ended[0]?.outputs).toEqual({
      'claude.response.content': [
        { type: 'text', text: 'Final answer', formatter: expect.any(String) },
      ],
    });
  });

  test('serializes result payload fields before ending the agent span', async () => {
    const mock = createMockTracer();
    const middleware = createTracedQuery(
      (() =>
        createSequenceQueryStream([
          {
            type: 'system',
            subtype: 'init',
            session_id: 'session-1',
            model: 'claude-sonnet',
          } as SDKMessage,
          {
            type: 'result',
            result: { cost: 1n },
            stop_reason: { detail: () => 'done' },
            num_turns: 2n,
            total_cost_usd: 1.25,
            subtype: 'end_turn',
            is_error: false,
          } as SDKMessage,
        ])) as ClaudeQuery,
      mock.tracer,
      { startInstance: () => {}, finishInstance: () => {} } as never,
      { agentIdentifier: 'claude-test' },
      createClaudeRuntimeController()
    );

    await collectMessages(middleware.tracedQuery({ prompt: 'test' }));

    const agentEnd = mock.ended.find((entry) => entry.span.spanType === 'claude:agent');
    expect(agentEnd?.outputs).toEqual({
      result: { cost: '1' },
      subtype: 'end_turn',
      stop_reason: { detail: expect.any(String) },
      num_turns: '2',
      total_cost_usd: 1.25,
      is_error: false,
    });
  });

  test('marks agent result spans as errors when the result reports an error', async () => {
    const mock = createMockTracer();
    const middleware = createTracedQuery(
      (() =>
        createSequenceQueryStream([
          {
            type: 'system',
            subtype: 'init',
            session_id: 'session-1',
            model: 'claude-sonnet',
          } as SDKMessage,
          {
            type: 'result',
            result: 'Hit max turns',
            subtype: 'error_max_turns',
            is_error: true,
            num_turns: 10,
          } as SDKMessage,
        ])) as ClaudeQuery,
      mock.tracer,
      { startInstance: () => {}, finishInstance: () => {} } as never,
      { agentIdentifier: 'claude-test' },
      createClaudeRuntimeController()
    );

    await collectMessages(middleware.tracedQuery({ prompt: 'test' }));

    const agentEnd = mock.ended.find((entry) => entry.span.spanType === 'claude:agent');
    expect(agentEnd?.error?.message).toBe('error_max_turns');
    expect(agentEnd?.outputs?.is_error).toBe(true);
  });
});
