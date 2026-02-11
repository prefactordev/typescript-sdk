// Session State Manager for Prefactor plugin
// Manages span hierarchies and timeouts per OpenClaw session

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
  // Tool call span (sequential, child of agent_run)
  toolCallSpanId: string | null;
}

interface SessionManagerConfig {
  userInteractionTimeoutMs: number;
  sessionTimeoutMs: number;
}

export class SessionStateManager {
  private sessions: Map<string, SessionSpanState> = new Map();
  private agent: Agent | null;
  private logger: Logger;
  private config: SessionManagerConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;
  // Track in-flight span creation operations to prevent duplicates
  private inFlightOperations: Map<string, Promise<string | null>> = new Map();

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
        toolCallSpanId: null,
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

  // Create synthetic session span (24hr lifetime)
  async createSessionSpan(sessionKey: string): Promise<string | null> {
    if (!this.agent) {
      this.logger.debug('no_agent_for_session_span', { sessionKey });
      return null;
    }

    const state = this.getOrCreateSessionState(sessionKey);

    // If session span already exists, don't recreate
    if (state.sessionSpanId) {
      return state.sessionSpanId;
    }

    // Check for in-flight operation to prevent duplicate spans
    const operationKey = `${sessionKey}:session`;
    const existingOperation = this.inFlightOperations.get(operationKey);
    if (existingOperation) {
      this.logger.debug('reusing_in_flight_session_span', { sessionKey });
      return existingOperation;
    }

    // Create and track the in-flight operation
    const operation = this.executeCreateSessionSpan(sessionKey, state);
    this.inFlightOperations.set(operationKey, operation);

    try {
      const spanId = await operation;
      return spanId;
    } finally {
      // Always clean up the in-flight operation
      this.inFlightOperations.delete(operationKey);
    }
  }

  private async executeCreateSessionSpan(
    sessionKey: string,
    state: SessionSpanState
  ): Promise<string | null> {
    if (!this.agent) return null;

    // Re-check after await in case another call completed while we were waiting
    if (state.sessionSpanId) {
      return state.sessionSpanId;
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'session',
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

  // Close session span and all its children
  async closeSessionSpan(sessionKey: string): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state) return;

    // Close all child spans first
    await this.closeAllChildSpans(sessionKey);

    // Close session span
    if (state.sessionSpanId) {
      await this.agent.finishSpan(sessionKey, state.sessionSpanId, 'complete');
      this.logger.info('session_span_closed', { sessionKey, spanId: state.sessionSpanId });
      state.sessionSpanId = null;
    }
  }

  // Create or get user interaction span (5min timeout)
  async createOrGetInteractionSpan(sessionKey: string): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);

    // Check for in-flight operation to prevent duplicate spans
    const operationKey = `${sessionKey}:interaction`;
    const existingOperation = this.inFlightOperations.get(operationKey);
    if (existingOperation) {
      this.logger.debug('reusing_in_flight_interaction_span', { sessionKey });
      return existingOperation;
    }

    // Create and track the in-flight operation
    const operation = this.executeCreateInteractionSpan(sessionKey, state);
    this.inFlightOperations.set(operationKey, operation);

    try {
      const spanId = await operation;
      return spanId;
    } finally {
      // Always clean up the in-flight operation
      this.inFlightOperations.delete(operationKey);
    }
  }

  private async executeCreateInteractionSpan(
    sessionKey: string,
    state: SessionSpanState
  ): Promise<string | null> {
    if (!this.agent) return null;

    const now = Date.now();

    // Ensure session span exists first
    if (!state.sessionSpanId) {
      await this.createSessionSpan(sessionKey);
    }

    // Re-check after await in case another call completed while we were waiting
    if (state.interactionSpanId) {
      const idleTime = now - state.interactionLastActivity;
      if (idleTime > this.config.userInteractionTimeoutMs) {
        this.logger.info('interaction_timeout_expired', {
          sessionKey,
          idleTimeMinutes: idleTime / 60000,
        });
        await this.closeInteractionSpan(sessionKey, 'cancelled');
      } else {
        // Interaction span exists and hasn't expired
        state.interactionLastActivity = now;
        return state.interactionSpanId;
      }
    }

    // Create new interaction span if needed
    if (!state.interactionSpanId) {
      const spanId = await this.agent.createSpan(
        sessionKey,
        'user_interaction',
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

    // Update last activity for existing interaction
    state.interactionLastActivity = now;
    return state.interactionSpanId;
  }

  // Close interaction span and all its children
  async closeInteractionSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete'
  ): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state || !state.interactionSpanId) return;

    // Close all child spans
    await this.closeAllChildSpans(sessionKey);

    // Close interaction span
    await this.agent.finishSpan(sessionKey, state.interactionSpanId, status);
    this.logger.info('interaction_span_closed', {
      sessionKey,
      spanId: state.interactionSpanId,
      status,
    });
    state.interactionSpanId = null;
  }

  // Create user_message span (immediate event)
  async createUserMessageSpan(sessionKey: string, rawContext: unknown): Promise<string | null> {
    if (!this.agent) return null;

    // Ensure interaction exists
    const interactionSpanId = await this.createOrGetInteractionSpan(sessionKey);
    if (!interactionSpanId) return null;

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:user_message',
      { raw: rawContext },
      interactionSpanId
    );

    if (spanId) {
      // User message is an instant event - close immediately
      await this.agent.finishSpan(sessionKey, spanId, 'complete');
      this.logger.debug('user_message_span_created', { sessionKey, spanId });
    }

    return spanId;
  }

  // Create agent_run span
  async createAgentRunSpan(sessionKey: string, rawContext: unknown): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);

    // Ensure interaction exists and update activity
    const interactionSpanId = await this.createOrGetInteractionSpan(sessionKey);
    if (!interactionSpanId) return null;

    // Close any existing agent run (orphan cleanup)
    if (state.agentRunSpanId) {
      await this.closeAgentRunSpan(sessionKey, 'cancelled');
    }

    // Get the last 3 messages from the context to reduce payload size
    const raw = (rawContext as { raw?: { messages?: unknown[]; [key: string]: unknown } })?.raw;
    const filteredContext = raw?.messages
      ? { raw: { ...raw, messages: raw.messages.slice(-3) } }
      : { raw: rawContext };

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:agent_run',
      filteredContext,
      interactionSpanId // Child of interaction
    );

    if (spanId) {
      state.agentRunSpanId = spanId;
      this.logger.info('agent_run_span_created', { sessionKey, spanId });
    }

    return spanId;
  }

  // Close agent_run span
  async closeAgentRunSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete'
  ): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state || !state.agentRunSpanId) return;

    // Close any open tool spans first
    if (state.toolCallSpanId) {
      await this.closeToolCallSpan(sessionKey, 'cancelled');
    }

    await this.agent.finishSpan(sessionKey, state.agentRunSpanId, status);
    this.logger.info('agent_run_span_closed', {
      sessionKey,
      spanId: state.agentRunSpanId,
      status,
    });
    state.agentRunSpanId = null;
  }

  // Create tool_call span
  async createToolCallSpan(
    sessionKey: string,
    toolName: string,
    rawContext: unknown
  ): Promise<string | null> {
    if (!this.agent) return null;

    const state = this.getOrCreateSessionState(sessionKey);

    // Ensure agent run exists
    if (!state.agentRunSpanId) {
      this.logger.warn('tool_call_without_agent_run', { sessionKey, toolName });
      // Create agent run on-the-fly
      await this.createAgentRunSpan(sessionKey, rawContext);
    }

    // Close any existing tool call (sequential assumption)
    if (state.toolCallSpanId) {
      await this.closeToolCallSpan(sessionKey, 'complete');
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:tool_call',
      { toolName, raw: rawContext },
      state.agentRunSpanId // Child of agent_run
    );

    if (spanId) {
      state.toolCallSpanId = spanId;
      this.logger.info('tool_call_span_created', { sessionKey, spanId, tool: toolName });
    }

    return spanId;
  }

  // Close tool_call span
  async closeToolCallSpan(
    sessionKey: string,
    status: 'complete' | 'cancelled' | 'failed' = 'complete'
  ): Promise<void> {
    if (!this.agent) return;

    const state = this.sessions.get(sessionKey);
    if (!state || !state.toolCallSpanId) return;

    await this.agent.finishSpan(sessionKey, state.toolCallSpanId, status);
    this.logger.info('tool_call_span_closed', {
      sessionKey,
      spanId: state.toolCallSpanId,
      status,
    });
    state.toolCallSpanId = null;
  }

  // Create assistant_response span (immediate event)
  async createAssistantResponseSpan(
    sessionKey: string,
    rawContext: unknown
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
      interactionSpanId = await this.createOrGetInteractionSpan(sessionKey);
    }

    if (!interactionSpanId) {
      this.logger.error('assistant_response_no_interaction', { sessionKey });
      return null;
    }

    // Get the last 3 messages from the context to reduce payload size
    const raw = (rawContext as { raw?: { messages?: unknown[]; [key: string]: unknown } })?.raw;
    const filteredContext = raw?.messages
      ? { raw: { ...raw, messages: raw.messages.slice(-3) } }
      : { raw: rawContext };

    const spanId = await this.agent.createSpan(
      sessionKey,
      'openclaw:assistant_response',
      filteredContext,
      interactionSpanId // Child of interaction
    );

    if (spanId) {
      // Assistant response is an instant event - close immediately
      await this.agent.finishSpan(sessionKey, spanId, 'complete');
      this.logger.debug('assistant_response_span_created', { sessionKey, spanId });
    }

    return spanId;
  }

  // Close all child spans (agent_run, tool_call)
  private async closeAllChildSpans(sessionKey: string): Promise<void> {
    const state = this.sessions.get(sessionKey);
    if (!state) return;

    // Close tool call if open
    if (state.toolCallSpanId) {
      await this.closeToolCallSpan(sessionKey, 'cancelled');
    }

    // Close agent run if open
    if (state.agentRunSpanId) {
      await this.closeAgentRunSpan(sessionKey, 'cancelled');
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

  // Force cleanup all sessions (for gateway_stop)
  async cleanupAllSessions(): Promise<void> {
    this.logger.info('cleanup_all_sessions_start', { count: this.sessions.size });

    for (const [sessionKey, state] of this.sessions.entries()) {
      // Close all spans with failed status
      if (state.toolCallSpanId) {
        await this.closeToolCallSpan(sessionKey, 'failed');
      }
      if (state.agentRunSpanId) {
        await this.closeAgentRunSpan(sessionKey, 'failed');
      }
      if (state.interactionSpanId) {
        await this.closeInteractionSpan(sessionKey, 'failed');
      }
      if (state.sessionSpanId) {
        await this.closeSessionSpan(sessionKey);
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
}

// Factory function
export function createSessionStateManager(
  agent: Agent | null,
  logger: Logger,
  config?: Partial<SessionManagerConfig>
): SessionStateManager {
  return new SessionStateManager(agent, logger, config);
}
