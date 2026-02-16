// Session State Manager for Prefactor plugin
// Manages span hierarchies and timeouts per OpenClaw session
// All public methods are serialized per session key via the operation queue

import type { Agent } from './agent.js';
import type { Logger } from './logger.js';

// Session state structure tracking all active spans
interface SessionSpanState {
  sessionKey: string;
  // Synthetic session span (24hr timeout)
  sessionSpanId: string | null;
  sessionCreatedAt: number;
  // User interaction span (5min timeout)
  interactionSpanId: string | null;
  interactionLastActivity: number;
  // Agent run span (child of interaction)
  agentRunSpanId: string | null;
  // Tool call spans (concurrent, children of agent_run)
  toolCallSpans: Array<{ spanId: string; toolName: string }>;
}

interface SessionManagerConfig {
  userInteractionTimeoutMs: number;
  sessionTimeoutMs: number;
}

// Serializes async operations per session key to prevent race conditions
// between fire-and-forget hook handlers (e.g. createAgentRunSpan must complete
// before closeAgentRunSpan can execute on the same session)
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

    const next = current.then(() => operation().then(resolve, reject));

    // Store the queue chain — catch to prevent unhandled rejection propagation
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
      userInteractionTimeoutMs: config.userInteractionTimeoutMs || 5 * 60 * 1000, // 5 minutes
      sessionTimeoutMs: config.sessionTimeoutMs || 24 * 60 * 60 * 1000, // 24 hours
    };

    // Start cleanup interval
    this.startCleanupInterval();

    this.logger.info('session_manager_init', {
      interactionTimeoutMinutes: this.config.userInteractionTimeoutMs / 60000,
      sessionTimeoutHours: this.config.sessionTimeoutMs / 3600000,
    });
  }

  private startCleanupInterval(): void {
    // Check for expired sessions every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
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

  // --- Public methods (serialized via operation queue) ---

  // Create synthetic session span (24hr lifetime)
  async createSessionSpan(sessionKey: string): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () => this._createSessionSpan(sessionKey));
  }

  // Close session span and all its children
  async closeSessionSpan(sessionKey: string): Promise<void> {
    return this.queue.enqueue(sessionKey, () => this._closeSessionSpan(sessionKey));
  }

  // Create or get user interaction span (5min timeout)
  async createOrGetInteractionSpan(sessionKey: string): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () => this._createOrGetInteractionSpan(sessionKey));
  }

  // Close interaction span and all its children
  async closeInteractionSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete'
  ): Promise<void> {
    return this.queue.enqueue(sessionKey, () => this._closeInteractionSpan(sessionKey, status));
  }

  // Create user_message span (immediate event)
  async createUserMessageSpan(
    sessionKey: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () => this._createUserMessageSpan(sessionKey, payload));
  }

  // Create agent_run span
  async createAgentRunSpan(
    sessionKey: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () => this._createAgentRunSpan(sessionKey, payload));
  }

  // Close agent_run span
  async closeAgentRunSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete'
  ): Promise<void> {
    return this.queue.enqueue(sessionKey, () => this._closeAgentRunSpan(sessionKey, status));
  }

  // Create tool_call span (supports concurrent tool calls)
  async createToolCallSpan(
    sessionKey: string,
    toolName: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () =>
      this._createToolCallSpan(sessionKey, toolName, payload)
    );
  }

  // Close tool_call span by toolName match
  async closeToolCallSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete',
    toolName?: string
  ): Promise<void> {
    return this.queue.enqueue(sessionKey, () =>
      this._closeToolCallSpan(sessionKey, status, toolName)
    );
  }

  // Create assistant_response span (immediate event)
  async createAssistantResponseSpan(
    sessionKey: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    return this.queue.enqueue(sessionKey, () =>
      this._createAssistantResponseSpan(sessionKey, payload)
    );
  }

  // Force cleanup all sessions (for gateway_stop)
  async cleanupAllSessions(): Promise<void> {
    this.logger.info('cleanup_all_sessions_start', { count: this.sessions.size });

    for (const [sessionKey, state] of this.sessions.entries()) {
      // Close all spans with failed status (bypass queue — this is emergency cleanup)
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

  // Get session state for debugging
  getSessionState(sessionKey: string): SessionSpanState | undefined {
    return this.sessions.get(sessionKey);
  }

  // Get all session keys
  getAllSessionKeys(): string[] {
    return Array.from(this.sessions.keys());
  }

  // Check if interaction exists
  hasActiveInteraction(sessionKey: string): boolean {
    const state = this.sessions.get(sessionKey);
    return !!state?.interactionSpanId;
  }

  // --- Internal implementations (called within the operation queue) ---

  private async _createSessionSpan(sessionKey: string): Promise<string | null> {
    if (!this.agent) {
      this.logger.debug('no_agent_for_session_span', { sessionKey });
      return null;
    }

    const state = this.getOrCreateSessionState(sessionKey);

    // If session span already exists, don't recreate
    if (state.sessionSpanId) {
      return state.sessionSpanId;
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:session',
      { createdAt: new Date().toISOString() },
      null // No parent - this is the root
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

    // Close all child spans first
    await this._closeAllChildSpans(sessionKey);

    // Capture and null synchronously to prevent double-close
    const spanId = state.sessionSpanId;
    if (!spanId) return;
    state.sessionSpanId = null;

    await this.agent.finishSpan(sessionKey, spanId, 'complete');
    this.logger.info('session_span_closed', { sessionKey, spanId });
  }

  private async _createOrGetInteractionSpan(sessionKey: string): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);
    const now = Date.now();

    // Ensure session span exists first
    if (!state.sessionSpanId) {
      await this._createSessionSpan(sessionKey);
    }

    // Check if existing interaction has timed out
    if (state.interactionSpanId) {
      const idleTime = now - state.interactionLastActivity;
      if (idleTime > this.config.userInteractionTimeoutMs) {
        this.logger.info('interaction_timeout_expired', {
          sessionKey,
          idleTimeMinutes: idleTime / 60000,
        });
        await this._closeInteractionSpan(sessionKey, 'cancelled');
      } else {
        // Interaction span exists and hasn't expired
        state.interactionLastActivity = now;
        return state.interactionSpanId;
      }
    }

    // Create new interaction span
    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:user_interaction',
      { startedAt: new Date().toISOString() },
      state.sessionSpanId // Child of session
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

    // Close all child spans first
    await this._closeAllChildSpans(sessionKey);

    // Capture and null synchronously to prevent double-close
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

    // Ensure interaction exists
    const interactionSpanId = await this._createOrGetInteractionSpan(sessionKey);
    if (!interactionSpanId) return null;

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:user_message',
      payload,
      interactionSpanId
    );

    if (spanId) {
      // User message is an instant event - close immediately
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

    // Ensure interaction exists and update activity
    const interactionSpanId = await this._createOrGetInteractionSpan(sessionKey);
    if (!interactionSpanId) return null;

    // If agent run already exists (created on-the-fly by tool_call), reuse it
    // instead of closing and recreating. This prevents spurious 'cancelled' status
    // when before_agent_start fires after tool calls have already started.
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
      interactionSpanId // Child of interaction
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

    // Capture and null synchronously to prevent double-close
    const spanId = state.agentRunSpanId;
    if (!spanId) return;
    state.agentRunSpanId = null;

    // Close any open tool spans first
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

    // Ensure agent run exists
    if (!state.agentRunSpanId) {
      this.logger.warn('tool_call_without_agent_run', { sessionKey, toolName });
      // Create agent run on-the-fly with minimal payload
      await this._createAgentRunSpan(sessionKey, {});
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:tool_call',
      payload,
      state.agentRunSpanId // Child of agent_run
    );

    if (spanId) {
      state.toolCallSpans.push({ spanId, toolName });
      this.logger.info('tool_call_span_created', { sessionKey, spanId, tool: toolName });
    }

    return spanId;
  }

  private async _closeToolCallSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete',
    toolName?: string
  ): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state || state.toolCallSpans.length === 0) return;

    // Find the matching span - prefer last match by toolName, fall back to oldest
    let index = -1;
    if (toolName) {
      // Find last span matching this toolName
      for (let i = state.toolCallSpans.length - 1; i >= 0; i--) {
        if (state.toolCallSpans[i].toolName === toolName) {
          index = i;
          break;
        }
      }
    }
    if (index === -1) {
      // No toolName match or no toolName provided — take the oldest
      index = 0;
    }

    // Synchronously remove from array BEFORE the async finishSpan call
    // to prevent double-close from concurrent callers
    const [entry] = state.toolCallSpans.splice(index, 1);

    await this.agent.finishSpan(sessionKey, entry.spanId, status);
    this.logger.info('tool_call_span_closed', {
      sessionKey,
      spanId: entry.spanId,
      tool: entry.toolName,
      status,
    });
  }

  private async _closeAllToolCallSpans(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'cancelled'
  ): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state || state.toolCallSpans.length === 0) return;

    // Synchronously take all spans, then close them
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
    payload: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);

    // Check if interaction span exists and is still active (not timed out)
    const now = Date.now();
    const idleTime = state.interactionSpanId ? now - state.interactionLastActivity : Infinity;
    const isInteractionActive =
      state.interactionSpanId && idleTime <= this.config.userInteractionTimeoutMs;

    let interactionSpanId = state.interactionSpanId;
    if (!isInteractionActive) {
      // Interaction timed out or doesn't exist - create new one
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

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:assistant_response',
      payload,
      interactionSpanId // Child of interaction
    );

    if (spanId) {
      // Assistant response is an instant event - close immediately
      await this.agent.finishSpan(sessionKey, spanId, 'complete');
      this.logger.debug('assistant_response_span_created', { sessionKey, spanId });
    }

    return spanId;
  }

  // Close all child spans (agent_run, tool_calls)
  private async _closeAllChildSpans(sessionKey: string): Promise<void> {
    const state = this.sessions.get(sessionKey);
    if (!state) return;

    // Close all tool calls
    await this._closeAllToolCallSpans(sessionKey, 'cancelled');

    // Close agent run if open
    if (state.agentRunSpanId) {
      await this._closeAgentRunSpan(sessionKey, 'cancelled');
    }
  }

  // Cleanup expired sessions based on timeouts
  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();

    for (const [sessionKey, state] of this.sessions.entries()) {
      // Check session timeout (24hr)
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

      // Check interaction timeout (5min)
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

// Factory function
export function createSessionStateManager(
  agent: Agent | null,
  logger: Logger,
  config?: Partial<SessionManagerConfig>
): SessionStateManager {
  return new SessionStateManager(agent, logger, config);
}
