import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { type Span, SpanContext, SpanStatus, type SpanType } from '@prefactor/core';
import { PrefactorLiveKitSession } from '../src/session.js';

type RecordedEnd = {
  span: Span;
  outputs?: Record<string, unknown>;
  error?: Error;
};

class FakeEmitter {
  handlers = new Map<string, Array<(event: unknown) => void>>();

  on(event: string, handler: (event: unknown) => void): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  off(event: string, handler: (event: unknown) => void): void {
    const existing = this.handlers.get(event) ?? [];
    this.handlers.set(
      event,
      existing.filter((candidate) => candidate !== handler)
    );
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class FakeSession extends FakeEmitter {
  startCalls: unknown[] = [];
  startError: Error | null = null;
  llm = new FakeEmitter();
  stt = new FakeEmitter();
  tts = new FakeEmitter();

  async start(options: unknown): Promise<string> {
    this.startCalls.push(options);
    if (this.startError) {
      throw this.startError;
    }
    return 'started';
  }
}

class ThrowingEmitter extends FakeEmitter {
  constructor(
    private readonly failures: {
      on?: boolean;
      off?: boolean;
    }
  ) {
    super();
  }

  override on(event: string, handler: (event: unknown) => void): void {
    if (this.failures.on) {
      throw new Error(`failed to bind ${event}`);
    }
    super.on(event, handler);
  }

  override off(event: string, handler: (event: unknown) => void): void {
    if (this.failures.off) {
      throw new Error(`failed to unbind ${event}`);
    }
    super.off(event, handler);
  }
}

class ThrowingSession extends FakeSession {
  constructor(
    private readonly failures: {
      on?: boolean;
      off?: boolean;
      llmOn?: boolean;
      llmOff?: boolean;
    }
  ) {
    super();
    this.llm = new ThrowingEmitter({ on: failures.llmOn, off: failures.llmOff });
  }

  override on(event: string, handler: (event: unknown) => void): void {
    if (this.failures.on) {
      throw new Error(`failed to bind ${event}`);
    }
    super.on(event, handler);
  }

  override off(event: string, handler: (event: unknown) => void): void {
    if (this.failures.off) {
      throw new Error(`failed to unbind ${event}`);
    }
    super.off(event, handler);
  }
}

function flushQueue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createTestTracer() {
  const started: Span[] = [];
  const ended: RecordedEnd[] = [];
  let nextId = 1;

  return {
    tracer: {
      startSpan: (options: {
        name: string;
        spanType: string;
        inputs: Record<string, unknown>;
      }): Span => {
        const parent = SpanContext.getCurrent();
        const span: Span = {
          spanId: `span-${nextId++}`,
          parentSpanId: parent?.spanId ?? null,
          traceId: parent?.traceId ?? `trace-${nextId}`,
          name: options.name,
          spanType: options.spanType as SpanType,
          startTime: Date.now(),
          endTime: null,
          status: SpanStatus.RUNNING,
          inputs: options.inputs,
          outputs: null,
          tokenUsage: null,
          error: null,
          metadata: {},
        };
        started.push(span);
        return span;
      },
      endSpan: (span: Span, options?: { outputs?: Record<string, unknown>; error?: Error }) => {
        span.endTime = Date.now();
        span.status = options?.error ? SpanStatus.ERROR : SpanStatus.SUCCESS;
        span.outputs = options?.outputs ?? null;
        ended.push({ span, outputs: options?.outputs, error: options?.error });
      },
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    },
    started,
    ended,
  };
}

describe('PrefactorLiveKitSession', () => {
  let warnSpy: ReturnType<typeof spyOn> | undefined;
  let errorSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    warnSpy?.mockRestore();
    errorSpy?.mockRestore();
    warnSpy = undefined;
    errorSpy = undefined;
    SpanContext.clear();
  });

  test('attach opens root span and binds listeners except deprecated metrics_collected', async () => {
    const { tracer, started } = createTestTracer();
    const startCalls: Array<Record<string, unknown> | undefined> = [];
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: (options?: Record<string, unknown>) => {
          startCalls.push(options);
        },
        finishInstance: () => {},
      } as never,
      agentInfo: { agentIdentifier: 'livekit-test' },
    });
    const session = new FakeSession();

    await sessionTracer.attach(session as never);

    expect(started[0]?.spanType).toBe('livekit:session');
    expect(startCalls).toHaveLength(1);
    expect(session.handlers.has('metrics_collected')).toBe(false);
    expect(session.handlers.has('session_usage_updated')).toBe(true);
  });

  test('concurrent attach binds listeners once', async () => {
    const { tracer, started } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();

    await Promise.all([
      sessionTracer.attach(session as never),
      sessionTracer.attach(session as never),
    ]);

    expect(started.filter((entry) => entry.spanType === 'livekit:session')).toHaveLength(1);
    expect(session.handlers.get('close')).toHaveLength(1);
    expect(session.handlers.get('function_tools_executed')).toHaveLength(1);
  });

  test('start delegates to session.start', async () => {
    class ExampleAgent {}

    const { tracer, started } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();

    const agent = new ExampleAgent();
    const result = await sessionTracer.start(session as never, { agent });

    expect(result).toBe('started');
    expect(session.startCalls).toEqual([{ agent }]);
    const rootSpan = started.find((entry) => entry.spanType === 'livekit:session');
    expect(rootSpan?.inputs.agentClass).toBe('ExampleAgent');
  });

  test('final user transcripts create a user turn span', async () => {
    const { tracer, started, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('user_input_transcribed', {
      createdAt: 100,
      transcript: 'hello world',
      isFinal: true,
      language: 'en',
      speakerId: 'speaker-1',
    });
    await flushQueue();

    const rootSpan = started.find((entry) => entry.spanType === 'livekit:session');
    const userTurn = ended.find((entry) => entry.span.spanType === 'livekit:user_turn');
    expect(userTurn?.span.parentSpanId).toBe(rootSpan?.spanId ?? null);
    expect(userTurn?.outputs).toMatchObject({
      status: 'completed',
      transcript: 'hello world',
      language: 'en',
      speakerId: 'speaker-1',
    });
  });

  test('speech plus assistant message completes assistant turn', async () => {
    const { tracer, started, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('speech_created', {
      createdAt: 200,
      source: 'generate_reply',
      userInitiated: true,
    });
    session.emit('conversation_item_added', {
      createdAt: 250,
      item: {
        role: 'assistant',
        createdAt: 250,
        interrupted: false,
        content: ['hello there'],
        metrics: { e2eLatency: 42 },
      },
    });
    session.emit('agent_state_changed', {
      oldState: 'speaking',
      newState: 'listening',
      createdAt: 275,
    });
    await flushQueue();

    const rootSpan = started.find((entry) => entry.spanType === 'livekit:session');
    const assistantTurn = ended.find((entry) => entry.span.spanType === 'livekit:assistant_turn');
    expect(assistantTurn?.span.parentSpanId).toBe(rootSpan?.spanId ?? null);
    expect(assistantTurn?.outputs).toMatchObject({
      status: 'completed',
      outputs: {
        message: {
          role: 'assistant',
        },
      },
    });
  });

  test('function tools executed emits child tool span under assistant turn', async () => {
    const { tracer, started, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('speech_created', {
      createdAt: 200,
      source: 'generate_reply',
      userInitiated: true,
    });
    await flushQueue();

    session.emit('function_tools_executed', {
      functionCalls: [
        {
          name: 'lookupWeather',
          callId: 'tool-1',
          arguments: '{"location":"Melbourne"}',
          createdAt: 220,
        },
      ],
      functionCallOutputs: [
        {
          name: 'lookupWeather',
          output: { weather: 'sunny' },
          isError: false,
        },
      ],
    });
    await flushQueue();

    const toolSpan = ended.find((entry) => entry.span.spanType === 'livekit:tool');
    const assistantTurn = started.find((entry) => entry.spanType === 'livekit:assistant_turn');
    expect(assistantTurn).toBeDefined();
    expect(toolSpan?.span.parentSpanId).toBe(assistantTurn?.spanId);
    expect(toolSpan?.outputs).toMatchObject({
      status: 'completed',
      isError: false,
    });
  });

  test('function tool events without valid names are logged and skipped', async () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const { tracer, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('function_tools_executed', {
      functionCalls: [
        {
          callId: 'tool-1',
          arguments: '{"location":"Melbourne"}',
        },
        {
          name: '   ',
          callId: 'tool-2',
          arguments: '{"location":"Sydney"}',
        },
      ],
      functionCallOutputs: [{ output: { weather: 'sunny' } }, { output: { weather: 'rain' } }],
    });
    await flushQueue();
    await sessionTracer.close();

    const toolSpans = ended.filter((entry) => entry.span.spanType === 'livekit:tool');
    const root = ended.find((entry) => entry.span.spanType === 'livekit:session');
    expect(toolSpans).toHaveLength(0);
    expect(root?.outputs?.conversation).toMatchObject({ functionCalls: 0 });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy?.mock.calls[0]?.[0]).toContain('Skipping malformed LiveKit function tool event');
  });

  test('logger failures do not interrupt malformed tool event handling', async () => {
    const loggerFailure = new Error('logger failed');
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {
      throw loggerFailure;
    });
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const { tracer, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('function_tools_executed', {
      functionCalls: [{ callId: 'tool-1' }],
      functionCallOutputs: [{}],
    });
    await flushQueue();
    await sessionTracer.close();

    const toolSpans = ended.filter((entry) => entry.span.spanType === 'livekit:tool');
    const root = ended.find((entry) => entry.span.spanType === 'livekit:session');
    expect(toolSpans).toHaveLength(0);
    expect(root?.outputs?.conversation).toMatchObject({ functionCalls: 0 });
    expect(errorSpy).toHaveBeenCalled();
  });

  test('state change events emit state spans', async () => {
    const { tracer, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('agent_state_changed', {
      oldState: 'listening',
      newState: 'speaking',
      createdAt: 200,
    });
    session.emit('user_state_changed', {
      oldState: 'listening',
      newState: 'speaking',
      createdAt: 210,
    });
    await flushQueue();

    const stateSpans = ended.filter((entry) => entry.span.spanType === 'livekit:state');
    expect(stateSpans).toHaveLength(2);
    expect(stateSpans[0]?.span.inputs).toMatchObject({
      actor: 'agent',
      oldState: 'listening',
      newState: 'speaking',
      eventType: 'agent_state_changed',
    });
    expect(stateSpans[1]?.span.inputs).toMatchObject({
      actor: 'user',
      oldState: 'listening',
      newState: 'speaking',
      eventType: 'user_state_changed',
    });
  });

  test('custom tool spans use the resolved span type in inputs', async () => {
    const { tracer, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
      toolSpanTypes: {
        lookupWeather: 'livekit:tool:lookup-weather',
      },
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('function_tools_executed', {
      functionCalls: [
        {
          name: 'lookupWeather',
          callId: 'tool-1',
          arguments: '{"location":"Melbourne"}',
          createdAt: 220,
        },
      ],
      functionCallOutputs: [
        {
          name: 'lookupWeather',
          output: { weather: 'sunny' },
          isError: false,
        },
      ],
    });
    await flushQueue();

    const toolSpan = ended.find((entry) => entry.span.spanType === 'livekit:tool:lookup-weather');
    expect(toolSpan?.span.inputs).toMatchObject({
      type: 'livekit:tool:lookup-weather',
      toolName: 'lookupWeather',
    });
  });

  test('error emits error span and fails active turns', async () => {
    const { tracer, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('speech_created', {
      createdAt: 200,
      source: 'generate_reply',
      userInitiated: true,
    });
    session.emit('error', {
      createdAt: 225,
      source: { constructor: { name: 'FakeLLM' } },
      error: new Error('boom'),
    });
    await flushQueue();

    const errorSpan = ended.find((entry) => entry.span.spanType === 'livekit:error');
    const assistantTurn = ended.find((entry) => entry.span.spanType === 'livekit:assistant_turn');
    expect(errorSpan?.error?.message).toBe('boom');
    expect(errorSpan?.outputs?.error).toMatchObject({
      type: 'Error',
      message: 'boom',
    });
    expect(assistantTurn?.error?.message).toBe('boom');
    expect(assistantTurn?.outputs?.error).toMatchObject({
      type: 'Error',
      message: 'boom',
    });
  });

  test('session close finalizes root span and finishes agent instance', async () => {
    const { tracer, ended } = createTestTracer();
    let finishCalls = 0;
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {
          finishCalls += 1;
        },
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('session_usage_updated', {
      usage: {
        modelUsage: [{ provider: 'openai', model: 'gpt-4.1-mini', totalTokens: 12 }],
      },
    });
    session.emit('close', {
      reason: 'user_initiated',
      createdAt: 300,
      error: null,
    });
    await flushQueue();

    const root = ended.find((entry) => entry.span.spanType === 'livekit:session');
    expect(root?.outputs).toMatchObject({
      status: 'completed',
      usage: {
        modelUsage: [{ provider: 'openai', model: 'gpt-4.1-mini', totalTokens: 12 }],
      },
    });
    expect(finishCalls).toBe(1);
    expect(session.handlers.get('close')).toHaveLength(0);
    expect(session.handlers.get('session_usage_updated')).toHaveLength(0);
    expect(session.llm.handlers.get('metrics_collected')).toHaveLength(0);
    expect(session.stt.handlers.get('metrics_collected')).toHaveLength(0);
    expect(session.tts.handlers.get('metrics_collected')).toHaveLength(0);
  });

  test('start rejection finalizes the root span as failed and finishes the agent instance', async () => {
    const { tracer, ended } = createTestTracer();
    let finishCalls = 0;
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {
          finishCalls += 1;
        },
      } as never,
    });
    const session = new FakeSession();
    session.startError = new Error('start failed');

    await expect(sessionTracer.start(session as never, { agent: { foo: 'bar' } })).rejects.toThrow(
      'start failed'
    );

    const root = ended.find((entry) => entry.span.spanType === 'livekit:session');
    expect(root?.outputs).toMatchObject({
      status: 'failed',
      error: {
        type: 'Error',
        message: 'start failed',
      },
    });
    expect(root?.error?.message).toBe('start failed');
    expect(finishCalls).toBe(1);
  });

  test('start rejection still surfaces when onDidClose fails', async () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const { tracer, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
      onDidClose: async () => {
        throw new Error('close callback failed');
      },
    });
    const session = new FakeSession();
    session.startError = new Error('start failed');

    await expect(sessionTracer.start(session as never, { agent: { foo: 'bar' } })).rejects.toThrow(
      'start failed'
    );

    const root = ended.find((entry) => entry.span.spanType === 'livekit:session');
    expect(root?.error?.message).toBe('start failed');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('PrefactorLiveKitSession onDidClose callback failed.'),
      expect.any(Error)
    );
  });

  test('manual close finalizes the root span as failed when an error was recorded', async () => {
    const { tracer, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('error', {
      createdAt: 225,
      source: { constructor: { name: 'FakeLLM' } },
      error: new Error('boom'),
    });
    await flushQueue();
    await sessionTracer.close();

    const root = ended.find((entry) => entry.span.spanType === 'livekit:session');
    expect(root?.outputs).toMatchObject({
      status: 'failed',
      error: {
        type: 'Error',
        message: 'boom',
      },
    });
  });

  test('close events with explicit errors finalize the root span as failed', async () => {
    const { tracer, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.emit('close', {
      reason: 'user_initiated',
      createdAt: 300,
      error: new Error('close failed'),
    });
    await flushQueue();

    const root = ended.find((entry) => entry.span.spanType === 'livekit:session');
    expect(root?.outputs).toMatchObject({
      status: 'failed',
      error: {
        type: 'Error',
        message: 'close failed',
      },
    });
  });

  test('listener binding failures are logged and swallowed during attach', async () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const { tracer, started } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new ThrowingSession({ on: true, llmOn: true });

    await expect(sessionTracer.attach(session as never)).resolves.toBeUndefined();

    expect(started.some((entry) => entry.spanType === 'livekit:session')).toBe(true);
    expect(session.handlers.size).toBe(0);
    expect(session.llm.handlers.size).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to bind LiveKit session event'),
      expect.any(Error)
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to bind LiveKit llm metrics emitter.'),
      expect.any(Error)
    );
  });

  test('listener unbinding failures are logged and finalization still completes', async () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const { tracer, ended } = createTestTracer();
    let finishCalls = 0;
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {
          finishCalls += 1;
        },
      } as never,
    });
    const session = new ThrowingSession({ off: true, llmOff: true });
    await sessionTracer.attach(session as never);

    await expect(sessionTracer.close()).resolves.toBeUndefined();

    const root = ended.find((entry) => entry.span.spanType === 'livekit:session');
    expect(root?.outputs).toMatchObject({ status: 'completed' });
    expect(finishCalls).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to unbind LiveKit session event'),
      expect.any(Error)
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to unbind LiveKit metrics emitter.'),
      expect.any(Error)
    );
  });

  test('component metrics emit llm, stt, and tts spans without deprecated session metrics', async () => {
    const { tracer, started, ended } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    session.stt.emit('metrics_collected', {
      metrics: {
        timestamp: 10,
        provider: 'deepgram',
      },
    });
    session.llm.emit('metrics_collected', {
      metrics: {
        timestamp: 20,
        provider: 'openai',
      },
    });
    session.tts.emit('metrics_collected', {
      metrics: {
        timestamp: 30,
        provider: 'cartesia',
      },
    });
    await flushQueue();

    const rootSpan = started.find((entry) => entry.spanType === 'livekit:session');
    const llmSpan = ended.find((entry) => entry.span.spanType === 'livekit:llm');
    const sttSpan = ended.find((entry) => entry.span.spanType === 'livekit:stt');
    const ttsSpan = ended.find((entry) => entry.span.spanType === 'livekit:tts');
    expect(llmSpan?.span.parentSpanId).toBe(rootSpan?.spanId ?? null);
    expect(sttSpan?.span.parentSpanId).toBe(rootSpan?.spanId ?? null);
    expect(ttsSpan?.span.parentSpanId).toBe(rootSpan?.spanId ?? null);
    expect(ended.some((entry) => entry.span.spanType === 'livekit:stt')).toBe(true);
    expect(ended.some((entry) => entry.span.spanType === 'livekit:llm')).toBe(true);
    expect(ended.some((entry) => entry.span.spanType === 'livekit:tts')).toBe(true);
    expect(session.handlers.has('metrics_collected')).toBe(false);
  });

  test('manual close is idempotent', async () => {
    const { tracer } = createTestTracer();
    let finishCalls = 0;
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {
          finishCalls += 1;
        },
      } as never,
    });
    const session = new FakeSession();
    await sessionTracer.attach(session as never);

    await sessionTracer.close();
    await sessionTracer.close();

    expect(finishCalls).toBe(1);
  });
});
