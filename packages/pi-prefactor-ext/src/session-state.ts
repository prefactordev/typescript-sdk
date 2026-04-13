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

interface SpanEntry {
  spanId: string;
  schemaName: string;
  createdAt: number;
  status: 'open' | 'closed';
}

interface SessionSpanState {
  sessionKey: string;
  sessionSpanId: string | null;
  sessionCreatedAt: number;
  interactionSpanId: string | null;
  interactionLastActivity: number;
  agentRunSpanId: string | null;
  toolCallSpans: ToolCallEntry[];
  pendingToolSpans: Map<string, Promise<string | null>>;  // Track pending tool span creations
  
  // Comprehensive span tracking
  openSpans: Map<string, SpanEntry>;  // spanId -> entry
  
  // Individual span references for direct close methods
  assistantResponseSpanId: string | null;
  userMessageSpanId: string | null;
  agentThinkingSpanId: string | null;
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
        pendingToolSpans: new Map(),
        openSpans: new Map(),
        assistantResponseSpanId: null,
        userMessageSpanId: null,
        agentThinkingSpanId: null,
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
      // Register in openSpans map
      state.openSpans.set(spanId, {
        spanId,
        schemaName: 'pi:session',
        createdAt: Date.now(),
        status: 'open',
      });
      this.logger.info('session_span_created', { sessionKey, spanId });
    }
    return spanId;
  }

  async closeSessionSpan(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state) return;

    this.logger.info('closeSessionSpan_start', {
      sessionKey,
      hasAgentRun: !!state.agentRunSpanId,
      hasInteraction: !!state.interactionSpanId,
      toolCallCount: state.toolCallSpans.length,
      openSpanCount: Array.from(state.openSpans.values()).filter(e => e.status === 'open').length,
    });

    await this.closeAllChildSpans(sessionKey);
    const spanId = state.sessionSpanId;
    if (!spanId) return;
    
    state.sessionSpanId = null;
    // Mark as closed in openSpans map
    const spanEntry = state.openSpans.get(spanId);
    if (spanEntry) {
      spanEntry.status = 'closed';
    }
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
      // Register in openSpans map
      state.openSpans.set(spanId, {
        spanId,
        schemaName: 'pi:user_interaction',
        createdAt: Date.now(),
        status: 'open',
      });
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
      state.userMessageSpanId = spanId;
      // Register in openSpans map
      state.openSpans.set(spanId, {
        spanId,
        schemaName: 'pi:user_message',
        createdAt: Date.now(),
        status: 'open',
      });
      this.logger.info('user_message_span_created', { sessionKey, spanId });
    }
    return spanId;
  }

  async closeUserMessageSpan(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state || !state.userMessageSpanId) return;
    
    const spanId = state.userMessageSpanId;
    state.userMessageSpanId = null;
    
    // Mark as closed in openSpans map
    const spanEntry = state.openSpans.get(spanId);
    if (spanEntry) {
      spanEntry.status = 'closed';
    }
    
    await this.agent.finishSpan(sessionKey, spanId, 'complete', {
      reason: 'message_delivered',
    });
    
    this.logger.info('user_message_span_closed', { sessionKey, spanId });
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
      // Register in openSpans map
      state.openSpans.set(spanId, {
        spanId,
        schemaName: 'pi:agent_run',
        createdAt: Date.now(),
        status: 'open',
      });
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
    
    // Mark as closed in openSpans map
    const spanEntry = state.openSpans.get(spanId);
    if (spanEntry) {
      spanEntry.status = 'closed';
    }
    
    this.logger.info('agent_run_closing', { sessionKey, spanId, status });
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
    
    // Create span promise and track it
    const spanPromise = this.agent.createSpan(
      sessionKey,
      'pi:tool_call',
      payload,
      state.agentRunSpanId
    );
    
    // Track pending creation (tool_result may arrive before span is created)
    const toolCallId = payload.toolCallId as string || `${toolName}-${Date.now()}`;
    state.pendingToolSpans.set(toolCallId, spanPromise);
    
    const spanId = await spanPromise;
    if (spanId) {
      state.toolCallSpans.push({ spanId, toolName, toolCallId });
      // Register in openSpans map
      state.openSpans.set(spanId, {
        spanId,
        schemaName: 'pi:tool_call',
        createdAt: Date.now(),
        status: 'open',
      });
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

    // Wait for pending span creation if needed (race condition fix)
    let entry = state.toolCallSpans.find(e => e.toolCallId === toolCallId || e.toolName === toolName);
    
    if (!entry) {
      // Check if span creation is still pending
      const pendingPromise = state.pendingToolSpans.get(toolCallId);
      if (pendingPromise) {
        this.logger.debug('waiting_for_pending_tool_span', { sessionKey, toolCallId });
        const spanId = await pendingPromise;
        state.pendingToolSpans.delete(toolCallId);
        if (spanId) {
          entry = { spanId, toolName, toolCallId };
          state.toolCallSpans.push(entry);
        }
      }
    }
    
    if (!entry) {
      this.logger.warn('tool_call_span_not_found', { sessionKey, toolCallId, toolName });
      return;
    }

    const resultPayload = { output: resultText || '', isError };
    const status = isError ? 'failed' : 'complete';
    
    // Mark as closed in openSpans map
    const spanEntry = state.openSpans.get(entry.spanId);
    if (spanEntry) {
      spanEntry.status = 'closed';
    }
    
    this.logger.info('tool_call_closing', { sessionKey, spanId: entry.spanId, isError, toolName });
    await this.agent.finishSpan(sessionKey, entry.spanId, status, resultPayload);
    this.logger.info('tool_call_span_closed', { sessionKey, spanId: entry.spanId, status });
    
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
      state.assistantResponseSpanId = spanId;
      // Register in openSpans map
      state.openSpans.set(spanId, {
        spanId,
        schemaName: 'pi:assistant_response',
        createdAt: Date.now(),
        status: 'open',
      });
      this.logger.info('assistant_response_span_created', { sessionKey, spanId });
    }
    return spanId;
  }

  async closeAssistantResponseSpan(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state || !state.assistantResponseSpanId) return;
    
    const spanId = state.assistantResponseSpanId;
    state.assistantResponseSpanId = null;
    
    // Mark as closed in openSpans map
    const spanEntry = state.openSpans.get(spanId);
    if (spanEntry) {
      spanEntry.status = 'closed';
    }
    
    await this.agent.finishSpan(sessionKey, spanId, 'complete', {
      reason: 'turn_ended',
    });
    
    this.logger.info('assistant_response_span_closed', { sessionKey, spanId });
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
      state.agentThinkingSpanId = spanId;
      // Register in openSpans map
      state.openSpans.set(spanId, {
        spanId,
        schemaName: 'pi:agent_thinking',
        createdAt: Date.now(),
        status: 'open',
      });
      this.logger.info('thinking_span_created', { sessionKey, spanId, thinkingLength: thinking.length });
    }
    return spanId;
  }

  async closeAgentThinkingSpan(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state || !state.agentThinkingSpanId) return;
    
    const spanId = state.agentThinkingSpanId;
    state.agentThinkingSpanId = null;
    
    // Mark as closed in openSpans map
    const spanEntry = state.openSpans.get(spanId);
    if (spanEntry) {
      spanEntry.status = 'closed';
    }
    
    await this.agent.finishSpan(sessionKey, spanId, 'complete', {
      reason: 'thinking_captured',
    });
    
    this.logger.info('thinking_span_closed', { sessionKey, spanId });
  }

  // Interaction span cleanup
  async closeInteractionSpan(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state || !state.interactionSpanId) return;

    const spanId = state.interactionSpanId;
    state.interactionSpanId = null;
    
    // Mark as closed in openSpans map
    const spanEntry = state.openSpans.get(spanId);
    if (spanEntry) {
      spanEntry.status = 'closed';
    }
    
    this.logger.info('interaction_span_closing', { sessionKey, spanId });
    await this.agent.finishSpan(sessionKey, spanId, 'complete');
    this.logger.info('interaction_span_closed', { sessionKey, spanId });
  }

  /**
   * Close all remaining open spans with specified status.
   * This is a defensive cleanup for spans not closed by their handlers.
   */
  async closeAllOpenSpans(
    sessionKey: string,
    defaultStatus: 'complete' | 'failed' | 'cancelled' = 'complete'
  ): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state) return;
    
    const openSpanCount = Array.from(state.openSpans.values())
      .filter(entry => entry.status === 'open').length;
    
    if (openSpanCount === 0) {
      this.logger.debug('no_open_spans_to_close', { sessionKey });
      return;
    }
    
    this.logger.info('closing_all_open_spans', {
      sessionKey,
      openSpanCount,
      defaultStatus,
    });
    
    // Close in reverse order (LIFO - newest first)
    const openSpans = Array.from(state.openSpans.values())
      .filter(entry => entry.status === 'open')
      .sort((a, b) => b.createdAt - a.createdAt);  // Newest first
    
    for (const entry of openSpans) {
      this.logger.warn('closing_orphaned_span', {
        sessionKey,
        spanId: entry.spanId,
        schemaName: entry.schemaName,
        age: Date.now() - entry.createdAt,
        status: defaultStatus,
      });
      
      await this.agent.finishSpan(
        sessionKey,
        entry.spanId,
        defaultStatus,
        { reason: 'session_shutdown_cleanup' }
      );
      
      entry.status = 'closed';
    }
    
    this.logger.info('all_open_spans_closed', {
      sessionKey,
      closedCount: openSpanCount,
    });
  }

  /**
   * Get the count of active sessions.
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  // Cleanup
  async cleanupAllSessions(): Promise<void> {
    this.logger.info('cleanup_all_sessions_start', { count: this.sessions.size });
    for (const [sessionKey, state] of this.sessions.entries()) {
      // Close ALL open spans with 'complete' status
      // (they're not failed, just interrupted by process exit)
      await this.closeAllOpenSpans(sessionKey, 'complete');
      
      // Close session span
      if (state.sessionSpanId) {
        const spanEntry = state.openSpans.get(state.sessionSpanId);
        if (spanEntry) {
          spanEntry.status = 'closed';
        }
        await this.agent?.finishSpan(sessionKey, state.sessionSpanId, 'complete');
      }
    }
    this.sessions.clear();
    this.logger.info('cleanup_all_sessions_complete');
  }

  private async closeAllChildSpans(sessionKey: string): Promise<void> {
    const state = this.sessions.get(sessionKey);
    if (!state || !this.agent) return;

    this.logger.info('closeAllChildSpans_start', {
      sessionKey,
      hasAgentRun: !!state.agentRunSpanId,
      hasInteraction: !!state.interactionSpanId,
      toolCallCount: state.toolCallSpans.length,
      openSpanCount: Array.from(state.openSpans.values()).filter(e => e.status === 'open').length,
    });

    // Close any remaining open spans with 'complete' status
    // (they're not failed, just missed by their handlers)
    const openSpans = Array.from(state.openSpans.values())
      .filter(entry => entry.status === 'open')
      .sort((a, b) => b.createdAt - a.createdAt);  // Newest first
    
    for (const entry of openSpans) {
      this.logger.warn('closing_missed_span', {
        sessionKey,
        spanId: entry.spanId,
        schemaName: entry.schemaName,
      });
      
      await this.agent.finishSpan(
        sessionKey,
        entry.spanId,
        'complete',  // Use 'complete', not 'failed'
        { reason: 'defensive_cleanup' }
      );
      
      entry.status = 'closed';
    }

    // Clear tracking arrays (spans are now closed)
    state.toolCallSpans = [];
    state.agentRunSpanId = null;
    state.interactionSpanId = null;
    state.assistantResponseSpanId = null;
    state.userMessageSpanId = null;
    state.agentThinkingSpanId = null;
    
    this.logger.info('closeAllChildSpans_complete', {
      sessionKey,
      closedCount: openSpans.length,
    });
  }
}

export function createSessionStateManager(
  agent: Agent | null,
  logger: Logger,
  config: Partial<SessionManagerConfig>
): SessionStateManager {
  return new SessionStateManager(agent, logger, config);
}
