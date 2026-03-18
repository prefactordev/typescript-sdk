import { beforeEach, describe, expect, test } from 'bun:test';
import type { HookCallback, HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk';
import { type Span, SpanStatus, type Tracer } from '@prefactor/core';
import { createInstrumentationHooks, finalizeAgentSpan, mergeHooks } from '../src/hooks.js';
import { handleMessageForTest, wrapQueryForTest } from '../src/traced-query.js';
import type { ClaudeMiddlewareConfig, TracedQueryState } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Extract the first hook callback for a given event. Throws if not found. */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

    const started = mock.started[0];
    expect(started.name).toBe('claude:tool-call');
    expect(started.spanType).toBe('claude:tool');
    expect(started.inputs).toEqual({
      'claude.tool.name': 'Read',
      toolName: 'Read',
      toolUseId: 'tool-use-1',
      input: { file_path: '/foo.ts' },
    });
  });

  test('PostToolUse ends the tool span and removes from map', async () => {
    const hooks = createInstrumentationHooks(mock.tracer, undefined, state);
    const preToolUse = getHook(hooks, 'PreToolUse');
    const postToolUse = getHook(hooks, 'PostToolUse');

    await preToolUse({ tool_name: 'Read', tool_input: { file_path: '/foo.ts' } }, 'tool-use-1', {
      signal,
    });
    await postToolUse({ tool_name: 'Read', tool_response: 'file contents here' }, 'tool-use-1', {
      signal,
    });

    expect(state.toolSpanMap.size).toBe(0);
    expect(mock.ended).toHaveLength(1);
    expect(mock.ended[0].outputs).toEqual({ output: 'file contents here' });
  });

  test('PostToolUseFailure ends tool span with error', async () => {
    const hooks = createInstrumentationHooks(mock.tracer, undefined, state);
    const preToolUse = getHook(hooks, 'PreToolUse');
    const postToolUseFailure = getHook(hooks, 'PostToolUseFailure');

    await preToolUse({ tool_name: 'Bash', tool_input: { command: 'exit 1' } }, 'tool-use-2', {
      signal,
    });
    await postToolUseFailure({}, 'tool-use-2', { signal });

    expect(state.toolSpanMap.size).toBe(0);
    expect(mock.ended).toHaveLength(1);
    expect(mock.ended[0].error).toBeInstanceOf(Error);
    expect(mock.ended[0].error?.message).toBe('Tool execution failed');
  });

  test('PreToolUse uses custom tool span types', async () => {
    const toolSpanTypes = { Read: 'claude:tool:read', Bash: 'claude:tool:bash' };
    const hooks = createInstrumentationHooks(mock.tracer, toolSpanTypes, state);
    const preToolUse = getHook(hooks, 'PreToolUse');

    await preToolUse({ tool_name: 'Read', tool_input: {} }, 'tool-use-3', { signal });

    expect(mock.started[0].spanType).toBe('claude:tool:read');
  });

  test('PreToolUse falls back to claude:tool for unknown tools', async () => {
    const toolSpanTypes = { Read: 'claude:tool:read' };
    const hooks = createInstrumentationHooks(mock.tracer, toolSpanTypes, state);
    const preToolUse = getHook(hooks, 'PreToolUse');

    await preToolUse({ tool_name: 'WebFetch', tool_input: {} }, 'tool-use-4', { signal });

    expect(mock.started[0].spanType).toBe('claude:tool');
  });

  test('captureTools=false omits tool input/output from spans', async () => {
    const config: ClaudeMiddlewareConfig = { captureTools: false };
    const hooks = createInstrumentationHooks(mock.tracer, undefined, state, config);
    const preToolUse = getHook(hooks, 'PreToolUse');
    const postToolUse = getHook(hooks, 'PostToolUse');

    await preToolUse({ tool_name: 'Read', tool_input: { file_path: '/secret.ts' } }, 'tool-use-5', {
      signal,
    });

    expect(mock.started[0].inputs).toEqual({
      'claude.tool.name': 'Read',
      toolName: 'Read',
      toolUseId: 'tool-use-5',
    });

    await postToolUse({ tool_name: 'Read', tool_response: 'secret data' }, 'tool-use-5', {
      signal,
    });

    expect(mock.ended[0].outputs).toEqual({});
  });

  test('SubagentStart creates a subagent span', async () => {
    const hooks = createInstrumentationHooks(mock.tracer, undefined, state);
    const subagentStart = getHook(hooks, 'SubagentStart');

    await subagentStart({ agent_id: 'agent-1', agent_type: 'code-reviewer' }, undefined, {
      signal,
    });

    expect(state.subagentSpanMap.size).toBe(1);
    expect(state.subagentSpanMap.has('agent-1')).toBe(true);

    const started = mock.started[0];
    expect(started.name).toBe('claude:subagent');
    expect(started.spanType).toBe('claude:subagent');
    expect(started.inputs).toEqual({ agent_id: 'agent-1', agent_type: 'code-reviewer' });
  });

  test('SubagentStop ends the subagent span', async () => {
    const hooks = createInstrumentationHooks(mock.tracer, undefined, state);
    const subagentStart = getHook(hooks, 'SubagentStart');
    const subagentStop = getHook(hooks, 'SubagentStop');

    await subagentStart({ agent_id: 'agent-1', agent_type: 'code-reviewer' }, undefined, {
      signal,
    });
    await subagentStop(
      {
        agent_id: 'agent-1',
        agent_type: 'code-reviewer',
        agent_transcript_path: '/tmp/transcript.json',
      },
      undefined,
      { signal }
    );

    expect(state.subagentSpanMap.size).toBe(0);
    expect(mock.ended).toHaveLength(1);
    expect(mock.ended[0].outputs).toEqual({
      agent_type: 'code-reviewer',
      transcript_path: '/tmp/transcript.json',
    });
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
    expect(mock.ended).toHaveLength(1);
    expect(mock.ended[0].outputs).toEqual({ result: 'done' });
    expect(mock.ended[0].tokenUsage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  test('does not finalize twice', () => {
    const mock = createMockTracer();
    const state = createState();
    state.agentSpan = createSpan('claude:agent', {}, 'claude:session');

    finalizeAgentSpan(state, mock.tracer, { result: 'first' });
    finalizeAgentSpan(state, mock.tracer, { result: 'second' });

    expect(mock.ended).toHaveLength(1);
    expect(mock.ended[0].outputs).toEqual({ result: 'first' });
  });

  test('does nothing if no agent span exists', () => {
    const mock = createMockTracer();
    const state = createState();

    finalizeAgentSpan(state, mock.tracer, { result: 'nothing' });

    expect(mock.ended).toHaveLength(0);
  });

  test('sets error when error is provided', () => {
    const mock = createMockTracer();
    const state = createState();
    state.agentSpan = createSpan('claude:agent', {}, 'claude:session');

    const error = new Error('error_max_turns');
    finalizeAgentSpan(state, mock.tracer, { result: 'failed', is_error: true }, undefined, error);

    expect(state.agentSpanFinished).toBe(true);
    expect(mock.ended).toHaveLength(1);
    expect(mock.ended[0].error).toBeInstanceOf(Error);
    expect(mock.ended[0].error?.message).toBe('error_max_turns');
  });
});

describe('mergeHooks', () => {
  test('returns instrumentation hooks when no user hooks', () => {
    const ours = { PreToolUse: [{ hooks: [async () => ({})] }] };
    const result = mergeHooks(ours as never, undefined);
    expect(result).toBe(ours);
  });

  test('puts instrumentation hooks first for pre-events', () => {
    const ourHook = async () => ({ id: 'ours' });
    const userHook = async () => ({ id: 'user' });

    const ours = { PreToolUse: [{ hooks: [ourHook] }] };
    const theirs = { PreToolUse: [{ hooks: [userHook] }] };

    const result = mergeHooks(ours as never, theirs as never);
    const merged = result.PreToolUse ?? [];

    expect(merged).toHaveLength(2);
    expect(merged[0].hooks?.[0]).toBe(ourHook);
    expect(merged[1].hooks?.[0]).toBe(userHook);
  });

  test('puts user hooks first for post-events', () => {
    const ourHook = async () => ({ id: 'ours' });
    const userHook = async () => ({ id: 'user' });

    const ours = { PostToolUse: [{ hooks: [ourHook] }] };
    const theirs = { PostToolUse: [{ hooks: [userHook] }] };

    const result = mergeHooks(ours as never, theirs as never);
    const merged = result.PostToolUse ?? [];

    expect(merged).toHaveLength(2);
    expect(merged[0].hooks?.[0]).toBe(userHook);
    expect(merged[1].hooks?.[0]).toBe(ourHook);
  });

  test('merges events from both sides', () => {
    const ours = { PreToolUse: [{ hooks: [async () => ({})] }] };
    const theirs = { SubagentStart: [{ hooks: [async () => ({})] }] };

    const result = mergeHooks(ours as never, theirs as never);

    expect(result.PreToolUse).toHaveLength(1);
    expect(result.SubagentStart).toHaveLength(1);
  });
});

describe('wrapQuery proxy', () => {
  test('proxies methods not explicitly defined on the generator', () => {
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {},
      interrupt: async () => {},
      close: () => {},
      setMaxThinkingTokens: async (_n: number | null) => {},
      accountInfo: async () => ({ email: 'test@test.com' }),
      supportedModels: async () => [{ id: 'opus' }],
      reconnectMcpServer: async (_name: string) => {},
      toggleMcpServer: async (_name: string, _enabled: boolean) => {},
    };

    const mockTracer = createMockTracer();
    const state = createState();

    const wrapped = wrapQueryForTest(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      mockStream as any,
      mockTracer.tracer,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      { startInstance: () => {}, finishInstance: () => {} } as any,
      undefined,
      undefined,
      state,
      undefined
    );

    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic proxy access
    expect(typeof (wrapped as any).setMaxThinkingTokens).toBe('function');
    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic proxy access
    expect(typeof (wrapped as any).accountInfo).toBe('function');
    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic proxy access
    expect(typeof (wrapped as any).supportedModels).toBe('function');
    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic proxy access
    expect(typeof (wrapped as any).reconnectMcpServer).toBe('function');
    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic proxy access
    expect(typeof (wrapped as any).toggleMcpServer).toBe('function');
    expect(typeof wrapped.interrupt).toBe('function');
    expect(typeof wrapped.close).toBe('function');
  });

  test('proxied methods call through to the underlying stream', async () => {
    const calls: string[] = [];
    const mockStream = {
      [Symbol.asyncIterator]: async function* () {},
      interrupt: async () => {},
      close: () => {},
      accountInfo: async () => {
        calls.push('accountInfo');
        return { email: 'test@test.com' };
      },
    };

    const mockTracer = createMockTracer();
    const state = createState();

    const wrapped = wrapQueryForTest(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      mockStream as any,
      mockTracer.tracer,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      { startInstance: () => {}, finishInstance: () => {} } as any,
      undefined,
      undefined,
      state,
      undefined
    );

    // biome-ignore lint/suspicious/noExplicitAny: testing dynamic proxy access
    await (wrapped as any).accountInfo();
    expect(calls).toEqual(['accountInfo']);
  });
});

describe('handleAssistantMessage captureContent', () => {
  test('stores assistant content as LLM span outputs when captureContent is enabled', () => {
    const mock = createMockTracer();
    const state = createState();
    state.agentSpan = createSpan('claude:agent', {}, 'claude:session');

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const agentManager = { startInstance: () => {}, finishInstance: () => {} } as any;

    handleMessageForTest(
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello world' }] } },
      mock.tracer,
      agentManager,
      undefined,
      undefined,
      state,
      { captureContent: true }
    );

    expect(state.currentLlmSpan).not.toBeNull();

    handleMessageForTest(
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Second turn' }] } },
      mock.tracer,
      agentManager,
      undefined,
      undefined,
      state,
      { captureContent: true }
    );

    expect(mock.ended).toHaveLength(1);
    expect(mock.ended[0].outputs).toEqual({
      'claude.response.content': [{ type: 'text', text: 'Hello world' }],
    });
  });

  test('does not capture content when captureContent is false', () => {
    const mock = createMockTracer();
    const state = createState();
    state.agentSpan = createSpan('claude:agent', {}, 'claude:session');

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const agentManager = { startInstance: () => {}, finishInstance: () => {} } as any;

    handleMessageForTest(
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Secret' }] } },
      mock.tracer,
      agentManager,
      undefined,
      undefined,
      state,
      { captureContent: false }
    );

    handleMessageForTest(
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Also secret' }] } },
      mock.tracer,
      agentManager,
      undefined,
      undefined,
      state,
      { captureContent: false }
    );

    expect(mock.ended).toHaveLength(1);
    expect(mock.ended[0].outputs).toEqual({});
  });

  test('result message ends LLM span with captured outputs', () => {
    const mock = createMockTracer();
    const state = createState();
    state.agentSpan = createSpan('claude:agent', {}, 'claude:session');

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const agentManager = { startInstance: () => {}, finishInstance: () => {} } as any;

    handleMessageForTest(
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Final answer' }] } },
      mock.tracer,
      agentManager,
      undefined,
      undefined,
      state,
      { captureContent: true }
    );

    handleMessageForTest(
      { type: 'result', result: 'done', subtype: 'end_turn', is_error: false },
      mock.tracer,
      agentManager,
      undefined,
      undefined,
      state,
      { captureContent: true }
    );

    expect(mock.ended[0].outputs).toEqual({
      'claude.response.content': [{ type: 'text', text: 'Final answer' }],
    });
  });
});

describe('handleResultMessage error results', () => {
  test('marks agent span as error when is_error is true', () => {
    const mock = createMockTracer();
    const state = createState();
    state.agentSpan = createSpan('claude:agent', {}, 'claude:session');

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const agentManager = { startInstance: () => {}, finishInstance: () => {} } as any;

    handleMessageForTest(
      {
        type: 'result',
        result: 'Hit max turns',
        subtype: 'error_max_turns',
        is_error: true,
        num_turns: 10,
      },
      mock.tracer,
      agentManager,
      undefined,
      undefined,
      state,
      undefined
    );

    const agentEnd = mock.ended.find((e) => e.span.spanType === 'claude:agent');
    expect(agentEnd).toBeDefined();
    expect(agentEnd?.error).toBeInstanceOf(Error);
    expect(agentEnd?.error?.message).toBe('error_max_turns');
    expect(agentEnd?.outputs?.is_error).toBe(true);
  });

  test('does not set error when is_error is false', () => {
    const mock = createMockTracer();
    const state = createState();
    state.agentSpan = createSpan('claude:agent', {}, 'claude:session');

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const agentManager = { startInstance: () => {}, finishInstance: () => {} } as any;

    handleMessageForTest(
      {
        type: 'result',
        result: 'Success',
        subtype: 'end_turn',
        is_error: false,
      },
      mock.tracer,
      agentManager,
      undefined,
      undefined,
      state,
      undefined
    );

    const agentEnd = mock.ended.find((e) => e.span.spanType === 'claude:agent');
    expect(agentEnd).toBeDefined();
    expect(agentEnd?.error).toBeUndefined();
  });
});
