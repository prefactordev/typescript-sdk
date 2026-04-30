import type { voice } from '@livekit/agents';
import {
  type AgentInstanceManager,
  getLogger,
  type Span,
  SpanContext,
  serializeValue,
  type Tracer,
} from '@prefactor/core';
import { resolveToolSpanType } from './schema.js';

type SessionAgentInfo = {
  agentId?: string;
  agentIdentifier?: string;
  agentName?: string;
  agentDescription?: string;
};

type SessionOptions = {
  tracer: Tracer;
  agentManager: AgentInstanceManager;
  agentInfo?: SessionAgentInfo;
  toolSpanTypes?: Record<string, string>;
  onDidClose?: () => void | Promise<void>;
};

type ActiveTurn = {
  span: Span | null;
  turnIndex: number;
  role: 'user' | 'assistant';
  createdAt?: number;
  source?: string;
  userInitiated?: boolean;
  autoFinishOnMessage: boolean;
  result: Record<string, unknown>;
  story: Record<string, unknown>;
};

type SessionFinalState = {
  status: 'completed' | 'failed';
  error?: Error;
};

type EventCallback = (event: unknown) => void;
type EventEmitterLike = {
  on?(event: string, callback: EventCallback): unknown;
  off?(event: string, callback: EventCallback): unknown;
};

const logger = getLogger('livekit-session');

export class PrefactorLiveKitSession {
  private readonly tracer: Tracer;
  private readonly agentManager: AgentInstanceManager;
  private readonly agentInfo?: SessionAgentInfo;
  private readonly toolSpanTypes?: Record<string, string>;
  private readonly onDidClose?: () => void;
  private session: voice.AgentSession<unknown> | null = null;
  private rootSpan: Span | null = null;
  private activeUserTurn: ActiveTurn | null = null;
  private activeAssistantTurn: ActiveTurn | null = null;
  private readonly boundSessionEvents = new Map<string, EventCallback>();
  private readonly boundMetricsEvents: Array<{
    emitter: EventEmitterLike;
    handler: EventCallback;
  }> = [];
  private chain: Promise<void> = Promise.resolve();
  private turnIndex = 0;
  private partialTranscripts: Array<Record<string, unknown>> = [];
  private conversationTurns: Array<Record<string, unknown>> = [];
  private conversationSummary = {
    itemsSeen: 0,
    assistantMessages: 0,
    userMessages: 0,
    functionCalls: 0,
  };
  private usageSummary: Record<string, unknown> = {};
  private agentInstanceStarted = false;
  private finalized = false;
  private attachPromise: Promise<void> | null = null;
  private closingPromise: Promise<void> | null = null;
  private pendingError: Error | null = null;
  private agentClass: string | undefined;

  constructor(options: SessionOptions) {
    this.tracer = options.tracer;
    this.agentManager = options.agentManager;
    this.agentInfo = options.agentInfo;
    this.toolSpanTypes = options.toolSpanTypes;
    this.onDidClose = options.onDidClose;
  }

  async attach(session: voice.AgentSession<unknown>): Promise<void> {
    if (this.finalized) {
      return;
    }

    if (this.attachPromise) {
      await this.attachPromise;
      if (this.finalized || (this.session === session && this.rootSpan)) {
        return;
      }
    }

    if (this.session === session && this.rootSpan) {
      return;
    }

    if (this.session && this.session !== session) {
      await this.close();
      if (this.finalized) {
        return;
      }
    }

    this.attachPromise = this.enqueue(async () => {
      if (this.finalized || (this.session === session && this.rootSpan)) {
        return;
      }

      this.session = session;
      this.bindSessionEvents(session);
      this.bindMetricsEmitters(session);

      if (!this.rootSpan) {
        this.startAgentInstance();
        this.rootSpan = this.safeStartSpan({
          name: this.agentInfo?.agentName ?? 'livekit-session',
          spanType: 'livekit:session',
          inputs: {
            name: this.agentInfo?.agentName ?? 'livekit-session',
            type: 'livekit:session',
            agentName: this.agentInfo?.agentName ?? this.agentInfo?.agentId ?? 'livekit-agent',
            sessionClass: session.constructor.name,
            metadata: {
              toolSpanTypes: this.toolSpanTypes ?? {},
              agentId: this.agentInfo?.agentId,
            },
            startedAt: Date.now(),
          },
        });
      }
    });

    try {
      await this.attachPromise;
    } finally {
      this.attachPromise = null;
    }
  }

  async start<T>(
    session: voice.AgentSession<unknown>,
    startOptions: T
  ): Promise<Awaited<ReturnType<voice.AgentSession<unknown>['start']>>> {
    await this.attach(session);
    this.recordAgentClass(startOptions);
    try {
      return await session.start(startOptions as never);
    } catch (error) {
      const startError = toError(error);
      this.pendingError = startError;
      await this.finalizeFromState(this.resolveFinalState(undefined, startError));
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closingPromise) {
      return this.closingPromise;
    }

    this.closingPromise = this.enqueue(async () => {
      await this.finalizeFromState(this.resolveFinalState());
    });
    return this.closingPromise;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private bindSessionEvents(session: voice.AgentSession<unknown>): void {
    const events: Array<[string, EventCallback]> = [
      [
        'user_input_transcribed',
        (event) => void this.handleQueued(() => this.onUserInputTranscribed(event)),
      ],
      [
        'conversation_item_added',
        (event) => void this.handleQueued(() => this.onConversationItemAdded(event)),
      ],
      [
        'function_tools_executed',
        (event) => void this.handleQueued(() => this.onFunctionToolsExecuted(event)),
      ],
      [
        'session_usage_updated',
        (event) => void this.handleQueued(() => this.onSessionUsageUpdated(event)),
      ],
      [
        'agent_state_changed',
        (event) => void this.handleQueued(() => this.onAgentStateChanged(event)),
      ],
      [
        'user_state_changed',
        (event) => void this.handleQueued(() => this.onUserStateChanged(event)),
      ],
      ['speech_created', (event) => void this.handleQueued(() => this.onSpeechCreated(event))],
      ['error', (event) => void this.handleQueued(() => this.onError(event))],
      ['close', (event) => void this.handleQueued(() => this.onClose(event))],
    ];

    for (const [eventName, handler] of events) {
      if (typeof session.on === 'function') {
        try {
          session.on(eventName as never, handler as never);
          this.boundSessionEvents.set(eventName, handler);
        } catch (error) {
          safeWarn(`Failed to bind LiveKit session event "${eventName}".`, error);
        }
      }
    }
  }

  private bindMetricsEmitters(session: voice.AgentSession<unknown>): void {
    this.bindMetricsEmitter((session as { llm?: EventEmitterLike }).llm, 'llm');
    this.bindMetricsEmitter((session as { stt?: EventEmitterLike }).stt, 'stt');
    this.bindMetricsEmitter((session as { tts?: EventEmitterLike }).tts, 'tts');
  }

  private bindMetricsEmitter(
    emitter: EventEmitterLike | undefined,
    kind: 'llm' | 'stt' | 'tts'
  ): void {
    if (!emitter?.on || typeof emitter.off !== 'function') {
      return;
    }

    const handler = (event: unknown) => {
      void this.handleQueued(() => this.onComponentMetrics(kind, event));
    };
    try {
      emitter.on('metrics_collected', handler);
      this.boundMetricsEvents.push({ emitter, handler });
    } catch (error) {
      safeWarn(`Failed to bind LiveKit ${kind} metrics emitter.`, error);
    }
  }

  private async handleQueued(task: () => Promise<void>): Promise<void> {
    await this.enqueue(async () => {
      try {
        await task();
      } catch (error) {
        safeWarn('Error processing LiveKit session event.', error);
      }
    });
  }

  private async onUserInputTranscribed(event: unknown): Promise<void> {
    if (!readBoolean(event, 'isFinal')) {
      this.partialTranscripts.push({
        transcript: readString(event, 'transcript'),
        createdAt: readNumber(event, 'createdAt'),
      });
      return;
    }

    const createdAt = readNumber(event, 'createdAt');
    const transcript = readString(event, 'transcript') ?? '';
    const language = readString(event, 'language');
    const speakerId = readString(event, 'speakerId');

    if (!this.activeUserTurn) {
      const turnIndex = this.nextTurnIndex();
      const completedTurn = this.createTurnStory('user', turnIndex, createdAt);
      completedTurn.transcript = transcript;
      completedTurn.language = language;
      completedTurn.speakerId = speakerId;
      completedTurn.isFinal = true;
      completedTurn.finishedAt = createdAt;
      completedTurn.status = 'completed';
      this.conversationTurns.push(completedTurn);
      this.conversationSummary.userMessages += 1;

      await this.emitChildSpan(null, {
        name: 'user_turn',
        spanType: 'livekit:user_turn',
        inputs: {
          name: 'user_turn',
          type: 'livekit:user_turn',
          turnIndex,
          createdAt,
          startedAt: createdAt,
          metadata: {},
        },
        outputs: {
          status: 'completed',
          transcript,
          speakerId,
          language,
          isFinal: true,
          finishedAt: createdAt,
          metadata: {},
        },
      });
      return;
    }

    this.activeUserTurn.result.transcript = transcript;
    this.activeUserTurn.result.speakerId = speakerId;
    this.activeUserTurn.result.language = language;
    this.activeUserTurn.result.isFinal = true;
    this.activeUserTurn.story.transcript = transcript;
    this.activeUserTurn.story.speakerId = speakerId;
    this.activeUserTurn.story.language = language;
    this.activeUserTurn.story.isFinal = true;
    this.conversationSummary.userMessages += 1;
    this.finishActiveUserTurn('completed', createdAt);
  }

  private async onConversationItemAdded(event: unknown): Promise<void> {
    const item = readRecord(event, 'item');
    this.conversationSummary.itemsSeen += 1;
    if (!item) {
      return;
    }

    if (readString(item, 'role') !== 'assistant') {
      return;
    }

    const createdAt = readNumber(event, 'createdAt') ?? readNumber(item, 'createdAt');
    if (!this.activeAssistantTurn) {
      this.activeAssistantTurn = this.startAssistantTurn({
        createdAt,
        source: 'conversation_item_added',
        userInitiated: false,
        autoFinishOnMessage: true,
      });
    }

    const itemJson = serializeUnknown(item);
    const metrics = readSerializedMetrics(item);
    this.activeAssistantTurn.result.outputs = { message: itemJson };
    if (metrics) {
      this.activeAssistantTurn.result.metrics = metrics;
      this.activeAssistantTurn.story.metrics = metrics;
    }
    this.activeAssistantTurn.story.outputs = { message: itemJson };
    this.conversationSummary.assistantMessages += 1;

    if (this.activeAssistantTurn.autoFinishOnMessage) {
      this.finishActiveAssistantTurn('completed', createdAt);
    }
  }

  private async onFunctionToolsExecuted(event: unknown): Promise<void> {
    const zipped = readZippedFunctionCalls(event);
    for (const [call, output] of zipped) {
      const rawToolName = readString(call, 'name');
      const toolName = rawToolName?.trim();
      if (!toolName) {
        safeWarn('Skipping malformed LiveKit function tool event without a valid tool name.', call);
        continue;
      }

      this.conversationSummary.functionCalls += 1;
      const callId = readString(call, 'callId');
      const groupId = readString(call, 'groupId');
      const createdAt = readNumber(call, 'createdAt');
      const isError = readBoolean(output, 'isError');
      const errorPayload = isError
        ? serializeUnknown(readRecord(output, 'output') ?? output)
        : undefined;
      const inputs = parseArguments(call);
      const parent = this.activeAssistantTurn?.span ?? null;
      const spanType = resolveToolSpanType(toolName, this.toolSpanTypes);

      await this.emitChildSpan(parent, {
        name: toolName,
        spanType,
        inputs: {
          name: toolName,
          type: spanType,
          toolName,
          callId,
          groupId,
          createdAt,
          inputs,
          metadata: serializeUnknown(readRecord(call, 'extra') ?? {}),
          ...(this.activeAssistantTurn ? { turnIndex: this.activeAssistantTurn.turnIndex } : {}),
        },
        outputs: {
          status: isError ? 'failed' : 'completed',
          outputs: {
            name: readString(output, 'name'),
            output: serializeUnknown(readRecord(output, 'output') ?? readValue(output, 'output')),
          },
          isError,
          ...(errorPayload ? { error: errorPayload } : {}),
        },
        error: isError ? toError(readValue(output, 'output')) : undefined,
      });

      if (this.activeAssistantTurn) {
        const toolCalls = ensureArray(this.activeAssistantTurn.story, 'toolCalls');
        toolCalls.push({
          toolName,
          callId,
          createdAt,
          inputs,
          isError,
        });
      }
    }
  }

  private async onSessionUsageUpdated(event: unknown): Promise<void> {
    const usage = readRecord(event, 'usage');
    if (!usage) {
      return;
    }

    this.usageSummary = {
      modelUsage: serializeUnknown(readValue(usage, 'modelUsage')) ?? [],
    };
  }

  private async onAgentStateChanged(event: unknown): Promise<void> {
    const oldState = readString(event, 'oldState');
    const newState = readString(event, 'newState');
    const createdAt = readNumber(event, 'createdAt');

    await this.emitStateSpan('agent', oldState, newState, createdAt);

    if (oldState === 'speaking' && newState === 'listening') {
      this.finishActiveAssistantTurn('completed', createdAt);
    }
  }

  private async onUserStateChanged(event: unknown): Promise<void> {
    const oldState = readString(event, 'oldState');
    const newState = readString(event, 'newState');
    const createdAt = readNumber(event, 'createdAt');

    await this.emitStateSpan('user', oldState, newState, createdAt);

    if (oldState === 'listening' && newState === 'speaking') {
      this.activeUserTurn = this.startUserTurn(createdAt);
    }
  }

  private async emitStateSpan(
    actor: 'agent' | 'user',
    oldState: string | undefined,
    newState: string | undefined,
    createdAt: number | undefined
  ): Promise<void> {
    await this.emitChildSpan(this.rootSpan, {
      name: `${actor}_state_changed`,
      spanType: 'livekit:state',
      inputs: {
        name: `${actor}_state_changed`,
        type: 'livekit:state',
        actor,
        oldState,
        newState,
        eventType: `${actor}_state_changed`,
        createdAt,
        metadata: {},
      },
      outputs: {
        status: 'completed',
        metrics: {},
      },
    });
  }

  private async onSpeechCreated(event: unknown): Promise<void> {
    if (this.activeAssistantTurn) {
      return;
    }

    this.activeAssistantTurn = this.startAssistantTurn({
      createdAt: readNumber(event, 'createdAt'),
      source: readString(event, 'source') ?? 'unknown',
      userInitiated: readBoolean(event, 'userInitiated'),
      autoFinishOnMessage: false,
    });
  }

  private async onError(event: unknown): Promise<void> {
    const errorValue = readValue(event, 'error');
    const error = toError(errorValue);
    this.pendingError = error;

    await this.emitChildSpan(this.activeAssistantTurn?.span ?? this.activeUserTurn?.span ?? null, {
      name: 'livekit_error',
      spanType: 'livekit:error',
      inputs: {
        name: 'livekit_error',
        type: 'livekit:error',
        source: readSourceName(event),
        errorType: error.name,
        message: error.message,
        createdAt: readNumber(event, 'createdAt'),
        metadata: {},
      },
      outputs: {
        status: 'failed',
        error: serializeError(error),
      },
      error,
    });

    this.finishActiveAssistantTurn('failed', readNumber(event, 'createdAt'), error);
    this.finishActiveUserTurn('failed', readNumber(event, 'createdAt'), error);
  }

  private async onClose(event: unknown): Promise<void> {
    const reason = readString(event, 'reason');
    await this.finalizeFromState(this.resolveFinalState(reason, readValue(event, 'error')), reason);
  }

  private async onComponentMetrics(kind: 'llm' | 'stt' | 'tts', event: unknown): Promise<void> {
    const metrics = readRecord(event, 'metrics') ?? (isRecord(event) ? event : undefined);
    if (!metrics) {
      return;
    }

    const parent =
      kind === 'stt'
        ? (this.activeUserTurn?.span ?? null)
        : (this.activeAssistantTurn?.span ?? null);

    const payload = serializeUnknown(metrics);
    await this.emitChildSpan(parent, {
      name: `livekit:${kind}`,
      spanType: `livekit:${kind}`,
      inputs: {
        name: `livekit:${kind}`,
        type: `livekit:${kind}`,
        timestamp: readNumber(metrics, 'timestamp'),
        requestId: readString(metrics, 'requestId'),
        label: readString(metrics, 'label'),
        modelName: readString(metrics, 'modelName'),
        provider: readString(metrics, 'provider'),
        metadata: payload ?? {},
        ...(kind !== 'stt' && this.activeAssistantTurn
          ? { turnIndex: this.activeAssistantTurn.turnIndex }
          : {}),
      },
      outputs: {
        status: 'completed',
        metrics: payload ?? {},
      },
    });

    const activeTurn = kind === 'stt' ? this.activeUserTurn : this.activeAssistantTurn;
    if (activeTurn) {
      activeTurn.result.metrics = {
        ...(readRecord(activeTurn.result, 'metrics') ?? {}),
        [kind]: payload ?? {},
      };
      activeTurn.story.metrics = {
        ...(readRecord(activeTurn.story, 'metrics') ?? {}),
        [kind]: payload ?? {},
      };
    }
  }

  private startUserTurn(createdAt?: number): ActiveTurn {
    this.finishActiveUserTurn('cancelled', createdAt);
    const turnIndex = this.nextTurnIndex();
    const span = this.withParent(this.resolveParentSpan(null), () =>
      this.safeStartSpan({
        name: 'user_turn',
        spanType: 'livekit:user_turn',
        inputs: {
          name: 'user_turn',
          type: 'livekit:user_turn',
          turnIndex,
          createdAt,
          startedAt: createdAt,
          metadata: {},
        },
      })
    );
    const story = this.createTurnStory('user', turnIndex, createdAt);
    this.conversationTurns.push(story);
    return {
      span,
      turnIndex,
      role: 'user',
      createdAt,
      autoFinishOnMessage: false,
      result: {},
      story,
    };
  }

  private startAssistantTurn(options: {
    createdAt?: number;
    source: string;
    userInitiated: boolean;
    autoFinishOnMessage: boolean;
  }): ActiveTurn {
    if (this.activeAssistantTurn) {
      const fallbackStatus = this.activeAssistantTurn.result.outputs ? 'completed' : 'cancelled';
      this.finishActiveAssistantTurn(fallbackStatus, options.createdAt);
    }

    const turnIndex = this.nextTurnIndex();
    const span = this.withParent(this.resolveParentSpan(null), () =>
      this.safeStartSpan({
        name: 'assistant_turn',
        spanType: 'livekit:assistant_turn',
        inputs: {
          name: 'assistant_turn',
          type: 'livekit:assistant_turn',
          turnIndex,
          source: options.source,
          userInitiated: options.userInitiated,
          createdAt: options.createdAt,
          startedAt: options.createdAt,
          metadata: {},
        },
      })
    );
    const story = this.createTurnStory('assistant', turnIndex, options.createdAt, {
      source: options.source,
      userInitiated: options.userInitiated,
    });
    this.conversationTurns.push(story);

    return {
      span,
      turnIndex,
      role: 'assistant',
      createdAt: options.createdAt,
      source: options.source,
      userInitiated: options.userInitiated,
      autoFinishOnMessage: options.autoFinishOnMessage,
      result: {},
      story,
    };
  }

  private finishActiveUserTurn(status: string, finishedAt?: number, error?: Error): void {
    if (!this.activeUserTurn) {
      return;
    }

    const turn = this.activeUserTurn;
    this.activeUserTurn = null;
    this.endTurn(turn, status, finishedAt, error);
  }

  private finishActiveAssistantTurn(status: string, finishedAt?: number, error?: Error): void {
    if (!this.activeAssistantTurn) {
      return;
    }

    const turn = this.activeAssistantTurn;
    this.activeAssistantTurn = null;
    this.endTurn(turn, status, finishedAt, error);
  }

  private endTurn(turn: ActiveTurn, status: string, finishedAt?: number, error?: Error): void {
    turn.story.status = status;
    if (finishedAt !== undefined) {
      turn.story.finishedAt = finishedAt;
    }
    if (error) {
      turn.story.error = serializeError(error);
    }

    const outputs = {
      ...turn.result,
      status,
      ...(finishedAt !== undefined ? { finishedAt } : {}),
      ...(error ? { error: serializeError(error) } : {}),
    };

    if (turn.span) {
      this.safeEndSpan(turn.span, outputs, error);
    }
  }

  private async finalize(
    finalStatus: 'completed' | 'failed',
    closeReason?: string,
    error?: Error
  ): Promise<void> {
    if (this.finalized) {
      return;
    }
    this.finalized = true;

    this.unbindAllEvents();
    this.finishActiveAssistantTurn(
      finalStatus === 'failed' ? 'failed' : 'cancelled',
      Date.now(),
      error
    );
    this.finishActiveUserTurn(finalStatus === 'failed' ? 'failed' : 'cancelled', Date.now(), error);

    const rootOutputs = {
      status: finalStatus,
      usage: this.usageSummary,
      conversation: {
        ...this.conversationSummary,
        partialTranscripts: this.partialTranscripts,
        turns: this.conversationTurns,
      },
      ...(closeReason ? { metadata: { closeReason } } : {}),
      ...(error ? { error: serializeError(error) } : {}),
    };

    if (this.rootSpan) {
      this.safeEndSpan(this.rootSpan, rootOutputs, finalStatus === 'failed' ? error : undefined);
      this.rootSpan = null;
    }

    this.finishAgentInstance();
    this.session = null;
    try {
      await this.onDidClose?.();
    } catch (error) {
      safeWarn('PrefactorLiveKitSession onDidClose callback failed.', error);
    }
  }

  private async finalizeFromState(
    finalState: SessionFinalState,
    closeReason?: string
  ): Promise<void> {
    await this.finalize(finalState.status, closeReason, finalState.error);
  }

  private unbindAllEvents(): void {
    if (this.session?.off) {
      for (const [eventName, handler] of this.boundSessionEvents) {
        try {
          this.session.off(eventName as never, handler as never);
        } catch (error) {
          safeWarn(`Failed to unbind LiveKit session event "${eventName}".`, error);
        }
      }
    }
    this.boundSessionEvents.clear();

    for (const { emitter, handler } of this.boundMetricsEvents) {
      try {
        emitter.off?.('metrics_collected', handler);
      } catch (error) {
        safeWarn('Failed to unbind LiveKit metrics emitter.', error);
      }
    }
    this.boundMetricsEvents.length = 0;
  }

  private async emitChildSpan(
    parentSpan: Span | null,
    options: {
      name: string;
      spanType: string;
      inputs: Record<string, unknown>;
      outputs: Record<string, unknown>;
      error?: Error;
    }
  ): Promise<void> {
    const span = this.withParent(this.resolveParentSpan(parentSpan), () =>
      this.safeStartSpan({
        name: options.name,
        spanType: options.spanType,
        inputs: options.inputs,
      })
    );
    if (!span) {
      return;
    }

    this.safeEndSpan(span, options.outputs, options.error);
  }

  private resolveParentSpan(parentSpan: Span | null): Span | null {
    return parentSpan ?? this.rootSpan;
  }

  private resolveFinalState(closeReason?: string, explicitError?: unknown): SessionFinalState {
    const error = explicitError ? toError(explicitError) : (this.pendingError ?? undefined);
    if (closeReason === 'error' || error) {
      return {
        status: 'failed',
        ...(error ? { error } : {}),
      };
    }

    return { status: 'completed' };
  }

  private withParent<T>(parentSpan: Span | null, fn: () => T): T {
    if (!parentSpan) {
      return fn();
    }

    return SpanContext.run(parentSpan, fn);
  }

  private safeStartSpan(options: {
    name: string;
    spanType: string;
    inputs: Record<string, unknown>;
  }): Span | null {
    try {
      return this.tracer.startSpan(options);
    } catch (error) {
      safeWarn('Failed to start Prefactor span for LiveKit session.', error);
      return null;
    }
  }

  private safeEndSpan(span: Span, outputs: Record<string, unknown>, error?: Error): void {
    try {
      this.tracer.endSpan(span, {
        outputs,
        ...(error ? { error } : {}),
      });
    } catch (caughtError) {
      safeWarn('Failed to end Prefactor span for LiveKit session.', caughtError);
    }
  }

  private startAgentInstance(): void {
    if (this.agentInstanceStarted) {
      return;
    }

    try {
      this.agentManager.startInstance(this.agentInfo);
      this.agentInstanceStarted = true;
    } catch (error) {
      safeWarn('Failed to start Prefactor agent instance for LiveKit session.', error);
    }
  }

  private finishAgentInstance(): void {
    if (!this.agentInstanceStarted) {
      return;
    }

    try {
      this.agentManager.finishInstance();
    } catch (error) {
      safeWarn('Failed to finish Prefactor agent instance for LiveKit session.', error);
    } finally {
      this.agentInstanceStarted = false;
    }
  }

  private nextTurnIndex(): number {
    this.turnIndex += 1;
    return this.turnIndex;
  }

  private createTurnStory(
    role: 'user' | 'assistant',
    turnIndex: number,
    createdAt?: number,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      turnIndex,
      role,
      status: 'active',
      createdAt,
      startedAt: createdAt,
      metrics: {},
      ...(this.agentClass ? { agentClass: this.agentClass } : {}),
      ...extra,
    };
  }

  private recordAgentClass(startOptions: unknown): void {
    const agent = readValue(startOptions, 'agent');
    const agentClass = agent && typeof agent === 'object' ? agent.constructor?.name : undefined;
    if (!agentClass || !this.rootSpan) {
      return;
    }

    const agentClassName = String(agentClass);
    this.agentClass = agentClassName;
    this.rootSpan.inputs.agentClass = agentClassName;
    for (const turn of this.conversationTurns) {
      if (!turn.agentClass) {
        turn.agentClass = agentClassName;
      }
    }
  }
}

function safeWarn(message: string, error: unknown): void {
  try {
    logger.warn(message, error);
  } catch (err) {
    try {
      console.error(message, error, err);
    } catch {
      // Logging must never throw from instrumentation code.
    }
  }
}

function readSourceName(event: unknown): string | undefined {
  const source = readValue(event, 'source');
  if (typeof source === 'string') {
    return source;
  }
  if (source && typeof source === 'object') {
    return source.constructor?.name;
  }
  return undefined;
}

function readSerializedMetrics(item: Record<string, unknown>): Record<string, unknown> | undefined {
  const metrics = readValue(item, 'metrics');
  if (metrics === undefined) {
    return undefined;
  }

  const serialized = serializeUnknown(metrics);
  return isRecord(serialized) ? serialized : { value: serialized };
}

function serializeUnknown(value: unknown): unknown {
  return serializeValue(value);
}

function serializeError(error: Error): Record<string, unknown> {
  return {
    type: error.name,
    message: error.message,
    stacktrace: error.stack ?? '',
  };
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : JSON.stringify(serializeUnknown(error)));
}

function readZippedFunctionCalls(
  event: unknown
): Array<[Record<string, unknown>, Record<string, unknown>]> {
  const zipped = readValue(event, 'zipped');
  if (typeof zipped === 'function') {
    const value = zipped.call(event);
    if (Array.isArray(value)) {
      return value.filter(isTupleRecord) as Array<
        [Record<string, unknown>, Record<string, unknown>]
      >;
    }
  }

  const functionCalls = readArrayRecord(event, 'functionCalls');
  const functionCallOutputs = readArrayRecord(event, 'functionCallOutputs');
  return functionCalls.map((call, index) => [call, functionCallOutputs[index] ?? {}]);
}

function parseArguments(call: Record<string, unknown>): unknown {
  const argumentsValue = readValue(call, 'arguments');
  if (typeof argumentsValue !== 'string') {
    return serializeUnknown(argumentsValue);
  }

  try {
    return JSON.parse(argumentsValue);
  } catch {
    return argumentsValue;
  }
}

function ensureArray(target: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = target[key];
  if (Array.isArray(value)) {
    return value as Array<Record<string, unknown>>;
  }

  const next: Array<Record<string, unknown>> = [];
  target[key] = next;
  return next;
}

function readValue(target: unknown, key: string): unknown {
  if (!target || typeof target !== 'object') {
    return undefined;
  }

  return (target as Record<string, unknown>)[key];
}

function readRecord(target: unknown, key: string): Record<string, unknown> | undefined {
  const value = readValue(target, key);
  return isRecord(value) ? value : undefined;
}

function readArrayRecord(target: unknown, key: string): Array<Record<string, unknown>> {
  const value = readValue(target, key);
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function readString(target: unknown, key: string): string | undefined {
  const value = readValue(target, key);
  return typeof value === 'string' ? value : undefined;
}

function readNumber(target: unknown, key: string): number | undefined {
  const value = readValue(target, key);
  return typeof value === 'number' ? value : undefined;
}

function readBoolean(target: unknown, key: string): boolean {
  const value = readValue(target, key);
  return value === true;
}

function isTupleRecord(
  value: unknown
): value is [Record<string, unknown>, Record<string, unknown>] {
  return Array.isArray(value) && value.length === 2 && isRecord(value[0]) && isRecord(value[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
