import { afterEach, describe, expect, test } from 'bun:test';
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
  afterEach(() => {
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

  test('start delegates to session.start', async () => {
    const { tracer } = createTestTracer();
    const sessionTracer = new PrefactorLiveKitSession({
      tracer: tracer as never,
      agentManager: {
        startInstance: () => {},
        finishInstance: () => {},
      } as never,
    });
    const session = new FakeSession();

    const result = await sessionTracer.start(session as never, { agent: { foo: 'bar' } });

    expect(result).toBe('started');
    expect(session.startCalls).toEqual([{ agent: { foo: 'bar' } }]);
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
    const assistantTurn = ended.find((entry) => entry.span.spanType === 'livekit:assistant_turn');
    expect(toolSpan?.span.parentSpanId).toBeTruthy();
    expect(toolSpan?.span.parentSpanId).toBe(
      assistantTurn?.span.spanId ?? toolSpan?.span.parentSpanId
    );
    expect(toolSpan?.outputs).toMatchObject({
      status: 'completed',
      isError: false,
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
    expect(assistantTurn?.error?.message).toBe('boom');
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
        errorType: 'Error',
        message: 'start failed',
      },
    });
    expect(root?.error?.message).toBe('start failed');
    expect(finishCalls).toBe(1);
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
        errorType: 'Error',
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
        errorType: 'Error',
        message: 'close failed',
      },
    });
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
