/**
 * Session State Manager for pi-prefactor extension
 * Manages span hierarchies and timeouts per pi session
 * 
 * @module
 */

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

export class SessionStateManager {
  private sessions: Map<string, SessionSpanState> = new Map();
  private agent: Agent | null;
  private logger: Logger;
  private config: SessionManagerConfig;

  constructor(
    agent: Agent | null,
    logger: Logger,
    config: Partial<SessionManagerConfig> = {}
  ) {
    this.agent = agent;
    this.logger = logger;
    this.config = {
      userInteractionTimeoutMs: config.userInteractionTimeoutMs || 5 * 60 * 1000,
      sessionTimeoutMs: config.sessionTimeoutMs || 24 * 60 * 60 * 1000,
    };

    this.logger.info('session_manager_init', {
      interactionTimeoutMinutes: this.config.userInteractionTimeoutMs / 60000,
      sessionTimeoutHours: this.config.sessionTimeoutMs / 3600000,
    });
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

  // Session spans
  async createSessionSpan(sessionKey: string): Promise<string | null> {
    if (!this.agent) return null;
    const state = this.getOrCreateSessionState(sessionKey);
    if (state.sessionSpanId) return state.sessionSpanId;

    const spanId = await this.agent.createSpan(
      sessionKey,
      'pi:session',
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

  async closeSessionSpan(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state) return;

    await this.closeAllChildSpans(sessionKey);
    const spanId = state.sessionSpanId;
    if (!spanId) return;
    
    state.sessionSpanId = null;
    await this.agent.finishSpan(sessionKey, spanId, 'complete');
    this.logger.info('session_span_closed', { sessionKey, spanId });
    this.sessions.delete(sessionKey);
  }

  // Interaction spans
  async createOrGetInteractionSpan(sessionKey: string): Promise<string | null> {
    if (!this.agent) return null;
    const state = this.getOrCreateSessionState(sessionKey);
    
    if (state.interactionSpanId) {
      state.interactionLastActivity = Date.now();
      return state.interactionSpanId;
    }

    const spanId = await this.agent.createSpan(
      sessionKey,
      'pi:user_interaction',
      { startedAt: new Date().toISOString() },
      state.sessionSpanId
    );
    if (spanId) {
      state.interactionSpanId = spanId;
      state.interactionLastActivity = Date.now();
      this.logger.info('interaction_span_created', { sessionKey, spanId });
    }
    return spanId;
  }

  // User message spans
  async createUserMessageSpan(
    sessionKey: string,
    payload: { text: string; timestamp: number }
  ): Promise<string | null> {
    if (!this.agent) return null;
    const state = this.getOrCreateSessionState(sessionKey);
    
    const spanId = await this.agent.createSpan(
      sessionKey,
      'pi:user_message',
      {
        text: payload.text,
        timestamp: new Date(payload.timestamp).toISOString(),
      },
      state.interactionSpanId
    );
    if (spanId) {
      this.logger.info('user_message_span_created', { sessionKey, spanId });
    }
    return spanId;
  }

  // Agent run spans
  async createAgentRunSpan(
    sessionKey: string,
    payload: { messageCount: number }
  ): Promise<string | null> {
    if (!this.agent) return null;
    const state = this.getOrCreateSessionState(sessionKey);
    
    const spanId = await this.agent.createSpan(
      sessionKey,
      'pi:agent_run',
      payload,
      state.interactionSpanId
    );
    if (spanId) {
      state.agentRunSpanId = spanId;
      this.logger.info('agent_run_span_created', { sessionKey, spanId });
    }
    return spanId;
  }

  async closeAgentRunSpan(
    sessionKey: string,
    status: 'complete' | 'failed' | 'cancelled' = 'complete'
  ): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state || !state.agentRunSpanId) return;

    const spanId = state.agentRunSpanId;
    state.agentRunSpanId = null;
    await this.agent.finishSpan(sessionKey, spanId, status);
    this.logger.info('agent_run_span_closed', { sessionKey, spanId, status });
  }

  // Tool call spans
  async createToolCallSpan(
    sessionKey: string,
    toolName: string,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.agent) return null;
    const state = this.getOrCreateSessionState(sessionKey);
    
    const spanId = await this.agent.createSpan(
      sessionKey,
      'pi:tool_call',
      payload,
      state.agentRunSpanId
    );
    if (spanId) {
      state.toolCallSpans.push({ spanId, toolName });
      this.logger.info('tool_call_span_created', { sessionKey, spanId, toolName });
    }
    return spanId;
  }

  async closeToolCallSpanWithResult(
    sessionKey: string,
    toolCallId: string,
    toolName: string,
    resultText: string | undefined,
    isError: boolean
  ): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state) return;

    const entry = state.toolCallSpans.find(e => e.toolCallId === toolCallId || e.toolName === toolName);
    if (!entry) {
      this.logger.warn('tool_call_span_not_found', { sessionKey, toolCallId, toolName });
      return;
    }

    const resultPayload = { output: resultText || '', isError };
    await this.agent.finishSpan(sessionKey, entry.spanId, isError ? 'failed' : 'complete', resultPayload);
    this.logger.info('tool_call_span_closed', { sessionKey, spanId: entry.spanId, isError });
    
    state.toolCallSpans = state.toolCallSpans.filter(e => e.spanId !== entry.spanId);
  }

  // Assistant response spans
  async createAssistantResponseSpan(
    sessionKey: string,
    text: string,
    tokens?: { input?: number; output?: number },
    metadata?: { provider?: string; model?: string }
  ): Promise<string | null> {
    if (!this.agent) return null;
    const state = this.getOrCreateSessionState(sessionKey);
    
    const spanId = await this.agent.createSpan(
      sessionKey,
      'pi:assistant_response',
      {
        text: text.slice(0, 10000), // Truncate for safety
        tokens,
        ...metadata,
      },
      state.interactionSpanId
    );
    if (spanId) {
      this.logger.info('assistant_response_span_created', { sessionKey, spanId });
    }
    return spanId;
  }

  // Agent thinking spans
  async createAgentThinkingSpan(
    sessionKey: string,
    thinking: string,
    tokens?: { input?: number; output?: number },
    metadata?: { provider?: string; model?: string }
  ): Promise<string | null> {
    if (!this.agent) return null;
    const state = this.getOrCreateSessionState(sessionKey);
    
    const spanId = await this.agent.createSpan(
      sessionKey,
      'pi:agent_thinking',
      {
        thinking: thinking.slice(0, 10000), // Truncate for safety
        tokens,
        ...metadata,
      },
      state.agentRunSpanId  // Thinking is child of agent_run
    );
    if (spanId) {
      this.logger.info('thinking_span_created', { sessionKey, spanId, thinkingLength: thinking.length });
    }
    return spanId;
  }

  // Cleanup
  async cleanupAllSessions(): Promise<void> {
    this.logger.info('cleanup_all_sessions_start', { count: this.sessions.size });
    for (const [sessionKey, state] of this.sessions.entries()) {
      await this.closeAllChildSpans(sessionKey);
      if (state.sessionSpanId) {
        await this.agent?.finishSpan(sessionKey, state.sessionSpanId, 'complete');
      }
    }
    this.sessions.clear();
    this.logger.info('cleanup_all_sessions_complete');
  }

  private async closeAllChildSpans(sessionKey: string): Promise<void> {
    const state = this.sessions.get(sessionKey);
    if (!state || !this.agent) return;

    // Close tool spans
    for (const toolSpan of state.toolCallSpans) {
      await this.agent.finishSpan(sessionKey, toolSpan.spanId, 'failed');
    }
    state.toolCallSpans = [];

    // Close agent run
    if (state.agentRunSpanId) {
      await this.agent.finishSpan(sessionKey, state.agentRunSpanId, 'failed');
      state.agentRunSpanId = null;
    }

    // Close interaction
    if (state.interactionSpanId) {
      await this.agent.finishSpan(sessionKey, state.interactionSpanId, 'failed');
      state.interactionSpanId = null;
    }
  }
}

export function createSessionStateManager(
  agent: Agent | null,
  logger: Logger,
  config: Partial<SessionManagerConfig>
): SessionStateManager {
  return new SessionStateManager(agent, logger, config);
}
