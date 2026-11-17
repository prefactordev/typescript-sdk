import { serializeValue } from '@prefactor/core';
import type { PrefactorSession, SpanHandle, SpanStatus } from './prefactor-session.js';
import { resolveToolSpanType } from './tool-definitions.js';

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

export interface SessionStartInfo {
  sessionId: string;
  cwd: string;
  mode: string;
  reason: string;
  provider?: string;
  model?: string;
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
  durationMs?: number;
}

export interface TracerLimits {
  maxInputLength: number;
  maxOutputLength: number;
}

/**
 * Maps one pi session's events onto Prefactor spans:
 * `pi:session` > `pi:agent_run` > `pi:llm` and `pi:tool*`, with nested tool calls under the tool
 * that made them.
 */
export class SessionTracer {
  private sessionSpan: SpanHandle | null = null;
  private runSpan: SpanHandle | null = null;
  private runFinalMessage: AssistantMessageLike | null = null;
  private pendingPrompt: { prompt: string; images?: unknown[] } | null = null;
  private contextMessages: unknown[] = [];
  /** JSON of each message in the context last recorded on a `pi:llm` span. */
  private recordedContext: string[] = [];
  private readonly toolSpans = new Map<string, SpanHandle>();

  constructor(
    private readonly session: PrefactorSession,
    private readonly limits: TracerLimits
  ) {}

  sessionStart(info: SessionStartInfo): void {
    this.sessionSpan = this.session.startSpan({
      schemaName: 'pi:session',
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

  /** Records the user prompt for the next agent run. */
  beforeAgentStart(prompt: string, images?: unknown[]): void {
    this.pendingPrompt = { prompt, ...(images?.length ? { images } : {}) };
  }

  agentStart(): void {
    this.endRun('cancelled', { stop_reason: 'interrupted' });
    const prompt = this.pendingPrompt;
    this.pendingPrompt = null;
    this.runFinalMessage = null;
    this.runSpan = this.session.startSpan({
      schemaName: 'pi:agent_run',
      payload: prompt ? (this.input(prompt) as Record<string, unknown>) : {},
      parent: this.sessionSpan,
    });
  }

  agentEnd(): void {
    const message = this.runFinalMessage;
    if (!message) {
      this.endRun('complete', {});
      return;
    }
    this.endRun(statusFromStopReason(message.stopReason), {
      response: this.output(textOf(message.content)),
      ...(message.stopReason ? { stop_reason: message.stopReason } : {}),
      ...(message.errorMessage ? { error_message: message.errorMessage } : {}),
    });
  }

  /** Stores the messages pi is about to send to the model. */
  context(messages: unknown[]): void {
    this.contextMessages = messages;
  }

  /** Records a finished assistant message as a `pi:llm` span. */
  assistantMessage(message: AssistantMessageLike): void {
    this.runFinalMessage = message;

    // Messages are compared by content because pi passes a fresh copy of the context each time.
    // When the context no longer starts with what was recorded, for example after compaction or
    // an extension replaced it, the whole context is recorded.
    const current = this.contextMessages.map((entry) => JSON.stringify(entry));
    const extendsRecorded =
      current.length >= this.recordedContext.length &&
      this.recordedContext.every((entry, index) => entry === current[index]);
    const newMessages = extendsRecorded
      ? this.contextMessages.slice(this.recordedContext.length)
      : this.contextMessages;
    this.recordedContext = current;

    const finishedAt = message.timestamp + (message.durationMs ?? 0);
    this.session.recordSpan({
      schemaName: 'pi:llm',
      parent: this.runSpan ?? this.sessionSpan,
      startedAt: message.timestamp,
      finishedAt: message.durationMs === undefined ? Date.now() : finishedAt,
      status: statusFromStopReason(message.stopReason),
      payload: {
        provider: message.provider,
        model: message.model,
        ...(message.api ? { api: message.api } : {}),
        messages: this.input(newMessages),
      },
      resultPayload: {
        content: this.output(message.content),
        ...(message.stopReason ? { stop_reason: message.stopReason } : {}),
        ...(message.errorMessage ? { error_message: message.errorMessage } : {}),
        ...(message.responseModel ? { response_model: message.responseModel } : {}),
        ...(message.responseId ? { response_id: message.responseId } : {}),
        ...(message.usage ? usageOutputs(message.usage) : {}),
        ...(message.durationMs !== undefined ? { duration_ms: message.durationMs } : {}),
      },
    });
  }

  toolStart(event: ToolExecutionStart): void {
    const parent =
      (event.parentToolCallId ? this.toolSpans.get(event.parentToolCallId) : undefined) ??
      this.runSpan ??
      this.sessionSpan;
    const span = this.session.startSpan({
      schemaName: resolveToolSpanType(event.toolName),
      parent,
      payload: {
        tool_name: event.toolName,
        tool_call_id: event.toolCallId,
        ...(event.parentToolCallId ? { parent_tool_call_id: event.parentToolCallId } : {}),
        input: this.input(event.args),
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
    this.session.finishSpan(span, event.isError ? 'failed' : 'complete', {
      ...(result.content !== undefined ? { content: this.output(result.content) } : {}),
      ...(result.details !== undefined ? { details: this.output(result.details) } : {}),
      is_error: event.isError,
      ...(event.durationMs !== undefined ? { duration_ms: event.durationMs } : {}),
    });
  }

  /**
   * Finishes every open span, then the session span. Open runs and tools are cancelled.
   */
  sessionShutdown(reason: string): void {
    for (const span of this.toolSpans.values()) {
      this.session.finishSpan(span, 'cancelled', { is_error: true });
    }
    this.toolSpans.clear();
    this.endRun('cancelled', { stop_reason: 'shutdown' });

    if (this.sessionSpan) {
      this.session.finishSpan(this.sessionSpan, 'complete', { reason });
      this.sessionSpan = null;
    }
  }

  private endRun(status: SpanStatus, resultPayload: Record<string, unknown>): void {
    if (!this.runSpan) {
      return;
    }
    this.session.finishSpan(this.runSpan, status, resultPayload);
    this.runSpan = null;
    this.runFinalMessage = null;
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

function textOf(content: unknown[]): string {
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

/**
 * Converts pi's usage to span outputs. Cache token counts go here because core's token usage has
 * no fields for them.
 */
function usageOutputs(
  usage: NonNullable<AssistantMessageLike['usage']>
): Record<string, Record<string, number>> {
  return {
    usage: {
      input: usage.input,
      output: usage.output,
      cache_read: usage.cacheRead,
      cache_write: usage.cacheWrite,
      ...(usage.reasoning !== undefined ? { reasoning: usage.reasoning } : {}),
      total: usage.totalTokens,
    },
    ...(usage.cost
      ? {
          cost: {
            input: usage.cost.input,
            output: usage.cost.output,
            cache_read: usage.cost.cacheRead,
            cache_write: usage.cost.cacheWrite,
            total: usage.cost.total,
          },
        }
      : {}),
  };
}
