import { serializeValue } from '@prefactor/core';
import type { PrefactorSession, SpanHandle, SpanStatus } from './prefactor-session.js';
import { AGENT_SPAN_VERSION, FALLBACK_TOOL_SPAN_TYPE, TOOL_SPAN_PREFIX } from './schema.js';

/** The fields of pi's assistant message that the tracer records. */
export interface AssistantMessageLike {
  role: 'assistant';
  content: unknown[];
  api?: string;
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
    totalTokens: number;
    cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  stopReason?: string;
  errorMessage?: string;
  timestamp: number;
  durationMs?: number;
}

/** The fields of pi's user message that the tracer records. */
export interface UserMessageLike {
  role: 'user';
  content: unknown;
}

export interface SessionStartInfo {
  sessionId: string;
  cwd: string;
  mode: string;
  reason: string;
  provider?: string;
  model?: string;
  /** Names of the tools pi has at session start. Other tools use the fallback span type. */
  toolNames: string[];
}

export interface ToolExecutionStart {
  toolCallId: string;
  toolName: string;
  args: unknown;
  parentToolCallId?: string;
}

export interface ToolExecutionEnd {
  toolCallId: string;
  result: unknown;
  isError: boolean;
}

export interface TracerLimits {
  maxInputLength: number;
  maxOutputLength: number;
}

type Usage = NonNullable<AssistantMessageLike['usage']>;

/**
 * Maps one pi session's events onto Prefactor's canonical agent spans, inside a `pi:session` root
 * span:
 *
 * - `$agent:system_message` when a run starts with a system prompt that differs from the last one
 *   recorded.
 * - `$agent:user_turn` with its `$agent:user_message` for each user message, including steering
 *   and follow-up messages.
 * - `$agent:assistant_turn` for the assistant's work after a user turn, holding each response's
 *   `$agent:llm_call`, its `$agent:assistant_thinking` and `$agent:assistant_message` blocks, and
 *   `$agent:tool:<name>` tool executions. A tool called by another tool is a child of that tool.
 *
 * The assistant turn finishes at the end of the run, or when a steering message starts the next
 * user turn. Start and finish times come from one clock that never repeats or goes back, so
 * Prefactor orders spans as they happened, no span finishes before it starts, and no parent
 * finishes before its children.
 */
export class SessionTracer {
  private sessionSpan: SpanHandle | null = null;
  private assistantTurn: {
    span: SpanHandle;
    lastMessage: AssistantMessageLike | null;
    usage: Usage | null;
  } | null = null;
  private userTurns = 0;
  private recordedSystemPrompt: string | null = null;
  private toolNames = new Set<string>();
  private lastTimestamp = 0;
  private readonly toolSpans = new Map<string, SpanHandle>();
  private readonly customSpans = new Set<SpanHandle>();

  constructor(
    private readonly session: PrefactorSession,
    private readonly limits: TracerLimits
  ) {}

  sessionStart(info: SessionStartInfo): void {
    this.toolNames = new Set(info.toolNames);
    this.sessionSpan = this.session.startSpan({
      schemaName: 'pi:session',
      startedAt: this.timestamp(),
      payload: {
        session_id: info.sessionId,
        cwd: info.cwd,
        mode: info.mode,
        reason: info.reason,
        ...(info.provider ? { provider: info.provider } : {}),
        ...(info.model ? { model: info.model } : {}),
      },
    });
  }

  /**
   * Starts a run. An assistant turn left open by a run that never ended is cancelled, and the
   * system prompt is recorded when it differs from the last one recorded.
   */
  agentStart(systemPrompt: string): void {
    this.endAssistantTurn('cancelled');
    if (systemPrompt === this.recordedSystemPrompt) {
      return;
    }
    this.recordedSystemPrompt = systemPrompt;
    const at = this.timestamp();
    this.session.recordSpan({
      schemaName: '$agent:system_message',
      parent: this.sessionSpan,
      startedAt: at,
      finishedAt: at,
      status: 'complete',
      payload: { _version: AGENT_SPAN_VERSION, text: this.input(systemPrompt) },
      resultPayload: { _version: AGENT_SPAN_VERSION },
    });
  }

  /** Finishes the run's assistant turn. */
  agentEnd(): void {
    this.endAssistantTurn();
  }

  /** Records a user message, which ends any open assistant turn and starts a user turn. */
  userMessage(message: UserMessageLike): void {
    this.endAssistantTurn();
    this.userTurns += 1;

    // The turn finishes with its message, which starts after it.
    const turnAt = this.timestamp();
    const messageAt = this.timestamp();
    const turn = this.session.recordSpan({
      schemaName: '$agent:user_turn',
      parent: this.sessionSpan,
      startedAt: turnAt,
      finishedAt: messageAt,
      status: 'complete',
      payload: { _version: AGENT_SPAN_VERSION, turn: this.userTurns },
      resultPayload: { _version: AGENT_SPAN_VERSION },
    });
    this.session.recordSpan({
      schemaName: '$agent:user_message',
      parent: turn,
      startedAt: messageAt,
      finishedAt: messageAt,
      status: 'complete',
      payload: { _version: AGENT_SPAN_VERSION, text: this.input(textOf(message.content)) },
      resultPayload: { _version: AGENT_SPAN_VERSION },
    });
  }

  /**
   * Records a finished assistant message as an `$agent:llm_call` with its thinking and text
   * blocks, in the open assistant turn, which it opens when there is none.
   */
  assistantMessage(message: AssistantMessageLike): void {
    const turn = this.openAssistantTurn(message.timestamp);
    turn.lastMessage = message;
    if (message.usage) {
      turn.usage = turn.usage ? addUsage(turn.usage, message.usage) : message.usage;
    }

    const startedAt = this.timestamp(message.timestamp);
    const finishedAt = this.timestamp(
      message.durationMs === undefined ? Date.now() : message.timestamp + message.durationMs
    );
    const status = statusFromStopReason(message.stopReason);
    this.session.recordSpan({
      schemaName: '$agent:llm_call',
      parent: turn.span,
      startedAt,
      finishedAt,
      status,
      payload: {
        _version: AGENT_SPAN_VERSION,
        request: {
          _version: AGENT_SPAN_VERSION,
          model: message.model,
          provider_name: message.provider,
          ...(message.api ? { api: message.api } : {}),
        },
      },
      resultPayload: {
        _version: AGENT_SPAN_VERSION,
        response: {
          _version: AGENT_SPAN_VERSION,
          ...(message.responseId ? { id: message.responseId } : {}),
          model: message.responseModel ?? message.model,
          provider_name: message.provider,
          ...(message.stopReason ? { stop_reason: message.stopReason } : {}),
          ...(message.usage ? { usage: canonicalUsage(message.usage) } : {}),
          ...(message.usage?.cost ? { cost: costOutputs(message.usage.cost) } : {}),
          timestamp_started: new Date(startedAt).toISOString(),
          timestamp_completed: new Date(finishedAt).toISOString(),
        },
        ...(status === 'failed' ? { error: message.errorMessage ?? 'The model call failed.' } : {}),
      },
    });

    for (const block of message.content) {
      this.recordContentBlock(turn.span, block);
    }
  }

  toolStart(event: ToolExecutionStart): void {
    const parent =
      (event.parentToolCallId ? this.toolSpans.get(event.parentToolCallId) : undefined) ??
      this.assistantTurn?.span ??
      this.sessionSpan;
    const registered = this.toolNames.has(event.toolName);
    const span = this.session.startSpan({
      schemaName: registered ? `${TOOL_SPAN_PREFIX}${event.toolName}` : FALLBACK_TOOL_SPAN_TYPE,
      parent,
      startedAt: this.timestamp(),
      payload: {
        _version: AGENT_SPAN_VERSION,
        tool_use_id: event.toolCallId,
        ...(registered ? {} : { tool_name: event.toolName }),
        params: this.input(event.args),
      },
    });
    this.toolSpans.set(event.toolCallId, span);
  }

  toolEnd(event: ToolExecutionEnd): void {
    const span = this.toolSpans.get(event.toolCallId);
    if (!span) {
      return;
    }
    this.toolSpans.delete(event.toolCallId);

    const result = (event.result ?? {}) as { content?: unknown; details?: unknown };
    if (event.isError) {
      this.session.finishSpan(
        span,
        'failed',
        { _version: AGENT_SPAN_VERSION, error: this.output(errorText(result.content)) },
        this.timestamp()
      );
      return;
    }
    this.session.finishSpan(
      span,
      'complete',
      {
        _version: AGENT_SPAN_VERSION,
        result: {
          ...(result.content !== undefined ? { content: this.output(result.content) } : {}),
          ...(result.details !== undefined ? { details: this.output(result.details) } : {}),
        },
      },
      this.timestamp()
    );
  }

  /**
   * Starts a span of one of the developer's span types. Its parent is `parent`, else the span of
   * the tool call `toolCallId` while that call runs, else the open assistant turn, else the
   * session span.
   */
  startCustomSpan(options: {
    schemaName: string;
    payload: Record<string, unknown>;
    parent?: SpanHandle;
    toolCallId?: string;
  }): SpanHandle {
    const span = this.session.startSpan({
      schemaName: options.schemaName,
      parent:
        options.parent ??
        (options.toolCallId ? this.toolSpans.get(options.toolCallId) : undefined) ??
        this.assistantTurn?.span ??
        this.sessionSpan,
      startedAt: this.timestamp(),
      payload: this.input(options.payload) as Record<string, unknown>,
    });
    this.customSpans.add(span);
    return span;
  }

  /** Finishes a span from {@link startCustomSpan}. A span already finished is left as it is. */
  finishCustomSpan(span: SpanHandle, status: SpanStatus, result: Record<string, unknown>): void {
    if (!this.customSpans.delete(span)) {
      return;
    }
    this.session.finishSpan(span, status, this.output(result) as Record<string, unknown>);
  }

  /**
   * Finishes every open span, then the session span. Open custom spans, tools and the open
   * assistant turn are cancelled.
   */
  sessionShutdown(reason: string): void {
    for (const span of this.customSpans) {
      this.session.finishSpan(span, 'cancelled', {});
    }
    this.customSpans.clear();
    // Newest first, so a nested tool, which starts after the tool that called it, finishes first.
    for (const span of [...this.toolSpans.values()].reverse()) {
      this.session.finishSpan(
        span,
        'cancelled',
        { _version: AGENT_SPAN_VERSION, error: 'The session ended before the tool finished.' },
        this.timestamp()
      );
    }
    this.toolSpans.clear();
    this.endAssistantTurn('cancelled');

    if (this.sessionSpan) {
      this.session.finishSpan(this.sessionSpan, 'complete', { reason }, this.timestamp());
      this.sessionSpan = null;
    }
  }

  private openAssistantTurn(at: number): NonNullable<SessionTracer['assistantTurn']> {
    if (!this.assistantTurn) {
      this.assistantTurn = {
        span: this.session.startSpan({
          schemaName: '$agent:assistant_turn',
          parent: this.sessionSpan,
          startedAt: this.timestamp(at),
          payload: { _version: AGENT_SPAN_VERSION },
        }),
        lastMessage: null,
        usage: null,
      };
    }
    return this.assistantTurn;
  }

  /**
   * Finishes the open assistant turn with the stop reason of its last response and the usage
   * summed over its responses. The status follows the last response unless one is given.
   */
  private endAssistantTurn(status?: SpanStatus): void {
    const turn = this.assistantTurn;
    if (!turn) {
      return;
    }
    this.assistantTurn = null;
    const stopReason = turn.lastMessage?.stopReason;
    this.session.finishSpan(
      turn.span,
      status ?? statusFromStopReason(stopReason),
      {
        _version: AGENT_SPAN_VERSION,
        ...(stopReason ? { stop_reason: stopReason } : {}),
        ...(turn.usage ? { usage: canonicalUsage(turn.usage) } : {}),
      },
      this.timestamp()
    );
  }

  private recordContentBlock(parent: SpanHandle, block: unknown): void {
    if (typeof block !== 'object' || block === null) {
      return;
    }
    const part = block as {
      type?: unknown;
      text?: unknown;
      thinking?: unknown;
      redacted?: unknown;
    };
    let span: { schemaName: string; payload: Record<string, unknown> } | null = null;
    if (part.type === 'text' && typeof part.text === 'string' && part.text !== '') {
      span = {
        schemaName: '$agent:assistant_message',
        payload: { _version: AGENT_SPAN_VERSION, text: this.output(part.text) },
      };
    } else if (part.type === 'thinking' && part.redacted === true) {
      span = {
        schemaName: '$agent:assistant_thinking',
        payload: { _version: AGENT_SPAN_VERSION, type: 'opaque', text: '[redacted]' },
      };
    } else if (
      part.type === 'thinking' &&
      typeof part.thinking === 'string' &&
      part.thinking !== ''
    ) {
      span = {
        schemaName: '$agent:assistant_thinking',
        payload: {
          _version: AGENT_SPAN_VERSION,
          type: 'transparent',
          text: this.output(part.thinking),
        },
      };
    }
    if (!span) {
      return;
    }
    const at = this.timestamp();
    this.session.recordSpan({
      ...span,
      parent,
      startedAt: at,
      finishedAt: at,
      status: 'complete',
      resultPayload: { _version: AGENT_SPAN_VERSION },
    });
  }

  /**
   * Returns `at` (default now), moved later when needed so that it is after every timestamp
   * returned before.
   */
  private timestamp(at: number = Date.now()): number {
    this.lastTimestamp = Math.max(at, this.lastTimestamp + 1);
    return this.lastTimestamp;
  }

  private input(value: unknown): unknown {
    return serializeValue(value, this.limits.maxInputLength);
  }

  private output(value: unknown): unknown {
    return serializeValue(value, this.limits.maxOutputLength);
  }
}

function statusFromStopReason(stopReason: string | undefined): SpanStatus {
  if (stopReason === 'error') {
    return 'failed';
  }
  if (stopReason === 'aborted') {
    return 'cancelled';
  }
  return 'complete';
}

/** Joins the text parts of message content, which is a string or an array of parts. */
function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
    )
    .map((part) => part.text)
    .join('');
}

function errorText(content: unknown): string {
  return textOf(content) || 'The tool failed.';
}

function addUsage(total: Usage, usage: Usage): Usage {
  const reasoning =
    total.reasoning === undefined && usage.reasoning === undefined
      ? undefined
      : (total.reasoning ?? 0) + (usage.reasoning ?? 0);
  return {
    input: total.input + usage.input,
    output: total.output + usage.output,
    cacheRead: total.cacheRead + usage.cacheRead,
    cacheWrite: total.cacheWrite + usage.cacheWrite,
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens: total.totalTokens + usage.totalTokens,
  };
}

/** Converts pi's usage to the canonical token fields. */
function canonicalUsage(usage: Usage): Record<string, number> {
  return {
    _version: AGENT_SPAN_VERSION,
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_input_tokens: usage.cacheRead,
    cache_creation_input_tokens: usage.cacheWrite,
    ...(usage.reasoning !== undefined ? { reasoning_tokens: usage.reasoning } : {}),
    total_tokens: usage.totalTokens,
  };
}

function costOutputs(cost: NonNullable<Usage['cost']>): Record<string, number> {
  return {
    input: cost.input,
    output: cost.output,
    cache_read: cost.cacheRead,
    cache_write: cost.cacheWrite,
    total: cost.total,
  };
}
