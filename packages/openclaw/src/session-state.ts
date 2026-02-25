// Session State Manager for Prefactor plugin
// Manages span hierarchies and timeouts per OpenClaw session
// All public methods are serialized per session key via the operation queue

import type { Agent } from './agent.js';
import type { Logger } from './logger.js';

interface ToolCallEntry {
  spanId: string;
  toolName: string;
  toolCallId?: string;
}

interface SessionSpanState {
  sessionKey: string;
  sessionSpanId: string | null;
  sessionCreatedAt: number;
  interactionSpanId: string | null;
  interactionLastActivity: number;
  agentRunSpanId: string | null;
  toolCallSpans: ToolCallEntry[];
}

interface SessionManagerConfig {
  userInteractionTimeoutMs: number;
  sessionTimeoutMs: number;
}

class SessionOperationQueue {
  private queues: Map<string, Promise<void>> = new Map();

  enqueue<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
    const current = this.queues.get(sessionKey) ?? Promise.resolve();

    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const next = current.then(() =>
      Promise.resolve()
        .then(() => operation())
        .then(resolve, reject)
    );

    this.queues.set(
      sessionKey,
      next.catch(() => {})
    );

    return result;
  }

  clear(sessionKey: string): void {
    this.queues.delete(sessionKey);
  }
}

export class SessionStateManager {
  private sessions: Map<string, SessionSpanState> = new Map();
  private agent: Agent | null;
  private logger: Logger;
  private config: SessionManagerConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private queue: SessionOperationQueue = new SessionOperationQueue();

  constructor(agent: Agent | null, logger: Logger, config: Partial<SessionManagerConfig> = {}) {
    this.agent = agent;
    this.logger = logger;
    this.config = {
      userInteractionTimeoutMs: config.userInteractionTimeoutMs || 5 * 60 * 1000,
      sessionTimeoutMs: config.sessionTimeoutMs || 24 * 60 * 60 * 1000,
    };

    this.startCleanupInterval();

    this.logger.info('session_manager_init', {
      interactionTimeoutMinutes: this.config.userInteractionTimeoutMs / 60000,
      sessionTimeoutHours: this.config.sessionTimeoutMs / 3600000,
    });
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      void this.cleanupExpiredSessions().catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error('cleanup_expired_sessions_failed', {
          error: {
            errorType: err.name,
            message: err.message,
            stacktrace: err.stack ?? '',
          },
        });
      });
    }, 30000);
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private getOrCreateSessionState(sessionKey: string): SessionSpanState {
    if (!this.sessions.has(sessionKey)) {
      const now = Date.now();
      const state: SessionSpanState = {
        sessionKey,
        sessionSpanId: null,
        sessionCreatedAt: now,
        interactionSpanId: null,
        interactionLastActivity: now,
        agentRunSpanId: null,
        toolCallSpans: [],
      };
      this.sessions.set(sessionKey, state);
      this.logger.debug('session_state_created', { sessionKey });
    }
    const state = this.sessions.get(sessionKey);
    if (!state) {
      throw new Error(`Session state ${sessionKey} not found after creation`);
    }
    return state;
  }

  // --- Public API ---

  async createSessionSpan(sessionKey: string): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () => this._createSessionSpan(sessionKey));
  }

  async closeSessionSpan(sessionKey: string): Promise<void> {
    return this.queue.enqueue(sessionKey, () => this._closeSessionSpan(sessionKey));
  }

  async createOrGetInteractionSpan(sessionKey: string): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () => this._createOrGetInteractionSpan(sessionKey));
  }

  async closeInteractionSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete'
  ): Promise<void> {
    return this.queue.enqueue(sessionKey, () => this._closeInteractionSpan(sessionKey, status));
  }

  async createUserMessageSpan(
    sessionKey: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () => this._createUserMessageSpan(sessionKey, payload));
  }

  async createAgentRunSpan(
    sessionKey: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () => this._createAgentRunSpan(sessionKey, payload));
  }

  async closeAgentRunSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete'
  ): Promise<void> {
    return this.queue.enqueue(sessionKey, () => this._closeAgentRunSpan(sessionKey, status));
  }

  async createToolCallSpan(
    sessionKey: string,
    toolName: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () =>
      this._createToolCallSpan(sessionKey, toolName, payload)
    );
  }

  async closeToolCallSpanWithResult(
    sessionKey: string,
    toolCallId: string,
    toolName: string,
    resultText: string | undefined,
    isError: boolean
  ): Promise<void> {
    return this.queue.enqueue(sessionKey, () =>
      this._closeToolCallSpanWithResult(sessionKey, toolCallId, toolName, resultText, isError)
    );
  }

  async createAssistantResponseSpan(
    sessionKey: string,
    text: string,
    tokens: { input?: number; output?: number } | undefined,
    metadata?: { provider?: string; model?: string }
  ): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () =>
      this._createAssistantResponseSpan(sessionKey, text, tokens, metadata)
    );
  }

  async createAgentThinkingSpan(
    sessionKey: string,
    thinking: string,
    tokens:
      | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
      | undefined,
    metadata?: { provider?: string; model?: string; signature?: string }
  ): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () =>
      this._createAgentThinkingSpan(sessionKey, thinking, tokens, metadata)
    );
  }

  async cleanupAllSessions(): Promise<void> {
    this.logger.info('cleanup_all_sessions_start', { count: this.sessions.size });

    for (const [sessionKey, state] of this.sessions.entries()) {
      await this._closeAllToolCallSpans(sessionKey, 'failed');
      if (state.agentRunSpanId) {
        await this._closeAgentRunSpan(sessionKey, 'failed');
      }
      if (state.interactionSpanId) {
        await this._closeInteractionSpan(sessionKey, 'failed');
      }
      if (state.sessionSpanId) {
        await this._closeSessionSpan(sessionKey);
      }
    }

    this.sessions.clear();
    this.stop();

    this.logger.info('cleanup_all_sessions_complete', {});
  }

  getSessionState(sessionKey: string): SessionSpanState | undefined {
    return this.sessions.get(sessionKey);
  }

  getAllSessionKeys(): string[] {
    return Array.from(this.sessions.keys());
  }

  hasActiveInteraction(sessionKey: string): boolean {
    const state = this.sessions.get(sessionKey);
    return !!state?.interactionSpanId;
  }

  // --- Internal implementations ---

  private async _createSessionSpan(sessionKey: string): Promise<string | null> {
    if (!this.agent) {
      this.logger.debug('no_agent_for_session_span', { sessionKey });
      return null;
    }

    const state = this.getOrCreateSessionState(sessionKey);

    if (state.sessionSpanId) {
      return state.sessionSpanId;
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:session',
      { createdAt: new Date().toISOString() },
      null
    );

    if (spanId) {
      state.sessionSpanId = spanId;
      state.sessionCreatedAt = Date.now();
      this.logger.info('session_span_created', { sessionKey, spanId });
    }

    return spanId;
  }

  private async _closeSessionSpan(sessionKey: string): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state) return;

    await this._closeAllChildSpans(sessionKey);

    const spanId = state.sessionSpanId;
    if (!spanId) return;
    state.sessionSpanId = null;

    await this.agent.finishSpan(sessionKey, spanId, 'complete');
    this.logger.info('session_span_closed', { sessionKey, spanId });

    this.sessions.delete(sessionKey);
    this.queue.clear(sessionKey);
  }

  private async _createOrGetInteractionSpan(sessionKey: string): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);
    const now = Date.now();

    if (!state.sessionSpanId) {
      await this._createSessionSpan(sessionKey);
    }

    if (state.interactionSpanId) {
      const idleTime = now - state.interactionLastActivity;
      if (idleTime > this.config.userInteractionTimeoutMs) {
        this.logger.info('interaction_timeout_expired', {
          sessionKey,
          idleTimeMinutes: idleTime / 60000,
        });
        await this._closeInteractionSpan(sessionKey, 'cancelled');
      } else {
        state.interactionLastActivity = now;
        return state.interactionSpanId;
      }
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:user_interaction',
      { startedAt: new Date().toISOString() },
      state.sessionSpanId
    );

    if (spanId) {
      state.interactionSpanId = spanId;
      state.interactionLastActivity = now;
      this.logger.info('interaction_span_created', { sessionKey, spanId });
    }

    return spanId;
  }

  private async _closeInteractionSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete'
  ): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state) return;

    await this._closeAllChildSpans(sessionKey);

    const spanId = state.interactionSpanId;
    if (!spanId) return;
    state.interactionSpanId = null;

    await this.agent.finishSpan(sessionKey, spanId, status);
    this.logger.info('interaction_span_closed', { sessionKey, spanId, status });
  }

  private async _createUserMessageSpan(
    sessionKey: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.agent) return null;

    const interactionSpanId = await this._createOrGetInteractionSpan(sessionKey);
    if (!interactionSpanId) return null;

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:user_message',
      payload,
      interactionSpanId
    );

    if (spanId) {
      await this.agent.finishSpan(sessionKey, spanId, 'complete');
      this.logger.debug('user_message_span_created', { sessionKey, spanId });
    }

    return spanId;
  }

  private async _createAgentRunSpan(
    sessionKey: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);

    const interactionSpanId = await this._createOrGetInteractionSpan(sessionKey);
    if (!interactionSpanId) return null;

    if (state.agentRunSpanId) {
      this.logger.debug('agent_run_span_reused', {
        sessionKey,
        spanId: state.agentRunSpanId,
      });
      return state.agentRunSpanId;
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:agent_run',
      payload,
      interactionSpanId
    );

    if (spanId) {
      state.agentRunSpanId = spanId;
      this.logger.info('agent_run_span_created', { sessionKey, spanId });
    }

    return spanId;
  }

  private async _closeAgentRunSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete'
  ): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state) return;

    const spanId = state.agentRunSpanId;
    if (!spanId) return;
    state.agentRunSpanId = null;

    await this._closeAllToolCallSpans(sessionKey, 'cancelled');

    await this.agent.finishSpan(sessionKey, spanId, status);
    this.logger.info('agent_run_span_closed', { sessionKey, spanId, status });
  }

  private async _createToolCallSpan(
    sessionKey: string,
    toolName: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);

    if (!state.agentRunSpanId) {
      this.logger.warn('tool_call_without_agent_run', { sessionKey, toolName });
      await this._createAgentRunSpan(sessionKey, {});

      if (!state.agentRunSpanId) {
        this.logger.error('failed_to_create_agent_run_for_tool_call', { sessionKey, toolName });
        return null;
      }
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:tool_call',
      payload,
      state.agentRunSpanId
    );

    if (spanId) {
      state.toolCallSpans.push({ spanId, toolName });
      this.logger.info('tool_call_span_created', { sessionKey, spanId, tool: toolName });
    }

    return spanId;
  }

  private async _closeToolCallSpanWithResult(
    sessionKey: string,
    toolCallId: string,
    toolName: string,
    resultText: string | undefined,
    isError: boolean
  ): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state || state.toolCallSpans.length === 0) return;

    // Try to match by toolCallId first, then by toolName (oldest first = FIFO)
    let index = -1;

    // First try exact match by toolCallId
    for (let i = 0; i < state.toolCallSpans.length; i++) {
      if (state.toolCallSpans[i].toolCallId === toolCallId) {
        index = i;
        break;
      }
    }

    // Fallback: match by toolName (take oldest = first)
    if (index === -1 && toolName) {
      for (let i = 0; i < state.toolCallSpans.length; i++) {
        if (state.toolCallSpans[i].toolName === toolName) {
          index = i;
          break;
        }
      }
    }

    // No match found
    if (index === -1) {
      this.logger.warn('tool_call_span_not_found', {
        sessionKey,
        toolCallId,
        toolName,
        pendingSpans: state.toolCallSpans.length,
      });
      return;
    }

    const [entry] = state.toolCallSpans.splice(index, 1);

    const status = isError ? 'failed' : 'complete';
    const resultPayload = resultText ? { text: resultText } : undefined;

    await this.agent.finishSpan(sessionKey, entry.spanId, status, resultPayload);
    this.logger.info('tool_call_span_closed', {
      sessionKey,
      spanId: entry.spanId,
      tool: entry.toolName,
      toolCallId,
      status,
      hasResult: !!resultText,
    });
  }

  private async _closeAllToolCallSpans(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'cancelled'
  ): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state || state.toolCallSpans.length === 0) return;

    const spans = state.toolCallSpans.splice(0);

    for (const entry of spans) {
      await this.agent.finishSpan(sessionKey, entry.spanId, status);
      this.logger.info('tool_call_span_closed', {
        sessionKey,
        spanId: entry.spanId,
        tool: entry.toolName,
        status,
      });
    }
  }

  private async _createAssistantResponseSpan(
    sessionKey: string,
    text: string,
    tokens: { input?: number; output?: number } | undefined,
    metadata?: { provider?: string; model?: string }
  ): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);

    const now = Date.now();
    const idleTime = state.interactionSpanId ? now - state.interactionLastActivity : Infinity;
    const isInteractionActive =
      state.interactionSpanId && idleTime <= this.config.userInteractionTimeoutMs;

    let interactionSpanId = state.interactionSpanId;
    if (!isInteractionActive) {
      this.logger.info('assistant_response_interaction_recreated', {
        sessionKey,
        reason: state.interactionSpanId ? 'timeout' : 'missing',
        idleTimeMinutes: state.interactionSpanId ? idleTime / 60000 : undefined,
      });
      interactionSpanId = await this._createOrGetInteractionSpan(sessionKey);
    }

    if (!interactionSpanId) {
      this.logger.error('assistant_response_no_interaction', { sessionKey });
      return null;
    }

    const payload: Record<string, unknown> = {
      text,
    };

    if (tokens) {
      payload.tokens = tokens;
    }

    if (metadata?.provider) {
      payload.provider = metadata.provider;
    }

    if (metadata?.model) {
      payload.model = metadata.model;
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:assistant_response',
      payload,
      interactionSpanId
    );

    if (spanId) {
      const resultPayload = { text };
      await this.agent.finishSpan(sessionKey, spanId, 'complete', resultPayload);
      this.logger.info('assistant_response_span_created', {
        sessionKey,
        spanId,
        textLength: text.length,
        tokens,
      });
    }

    return spanId;
  }

  private async _createAgentThinkingSpan(
    sessionKey: string,
    thinking: string,
    tokens:
      | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
      | undefined,
    metadata?: { provider?: string; model?: string; signature?: string }
  ): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);

    const interactionSpanId = await this._createOrGetInteractionSpan(sessionKey);
    if (!interactionSpanId) {
      this.logger.error('agent_thinking_no_interaction', { sessionKey });
      return null;
    }

    const payload: Record<string, unknown> = {
      thinking,
    };

    if (tokens) {
      payload.tokens = tokens;
    }

    if (metadata?.signature) {
      payload.signature = metadata.signature;
    }

    if (metadata?.provider) {
      payload.provider = metadata.provider;
    }

    if (metadata?.model) {
      payload.model = metadata.model;
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:agent_thinking',
      payload,
      interactionSpanId
    );

    if (spanId) {
      const resultPayload = { thinking };
      await this.agent.finishSpan(sessionKey, spanId, 'complete', resultPayload);
      this.logger.info('agent_thinking_span_created', {
        sessionKey,
        spanId,
        thinkingLength: thinking.length,
        tokens,
        signature: metadata?.signature,
      });
    }

    return spanId;
  }

  private async _closeAllChildSpans(sessionKey: string): Promise<void> {
    const state = this.sessions.get(sessionKey);
    if (!state) return;

    await this._closeAllToolCallSpans(sessionKey, 'cancelled');

    if (state.agentRunSpanId) {
      await this._closeAgentRunSpan(sessionKey, 'cancelled');
    }
  }

  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();

    for (const [sessionKey, state] of this.sessions.entries()) {
      if (state.sessionSpanId) {
        const sessionAge = now - state.sessionCreatedAt;
        if (sessionAge > this.config.sessionTimeoutMs) {
          this.logger.info('session_timeout_expired', {
            sessionKey,
            ageHours: sessionAge / 3600000,
          });
          await this.closeSessionSpan(sessionKey);
          continue;
        }
      }

      if (state.interactionSpanId) {
        const idleTime = now - state.interactionLastActivity;
        if (idleTime > this.config.userInteractionTimeoutMs) {
          this.logger.info('interaction_timeout_cleanup', {
            sessionKey,
            idleTimeMinutes: idleTime / 60000,
          });
          await this.closeInteractionSpan(sessionKey, 'cancelled');
        }
      }
    }
  }
}

export function createSessionStateManager(
  agent: Agent | null,
  logger: Logger,
  config?: Partial<SessionManagerConfig>
): SessionStateManager {
  return new SessionStateManager(agent, logger, config);
}
