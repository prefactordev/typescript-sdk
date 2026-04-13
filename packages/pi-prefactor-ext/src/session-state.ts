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
  agentRunSpanId: string | null;
  agentRunStartTime: number | null;  // P0 Critical Fix #3: Track start time for duration
  toolCallSpans: ToolCallEntry[];
  pendingToolSpans: Map<string, Promise<string | null>>;  // Track pending tool span creations
  
  // Comprehensive span tracking
  openSpans: Map<string, SpanEntry>;  // spanId -> entry
  
  // Individual span references for direct close methods
  userMessageSpanId: string | null;
  
  // File and activity tracking (P0 Critical Fix #5)
  filesModified: Set<string>;
  filesRead: Set<string>;
  filesCreated: string[];
  commandsRun: number;
  toolCalls: number;
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

    this.logger.debug('session_manager_init', {
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
        agentRunSpanId: null,
        agentRunStartTime: null,  // P0 Critical Fix #3
        toolCallSpans: [],
        pendingToolSpans: new Map(),
        openSpans: new Map(),
        userMessageSpanId: null,
        // File and activity tracking (P0 Critical Fix #5)
        filesModified: new Set(),
        filesRead: new Set(),
        filesCreated: [],
        commandsRun: 0,
        toolCalls: 0,
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
      this.logger.debug('session_span_created', { sessionKey, spanId });
    }
    return spanId;
  }

  async closeSessionSpan(sessionKey: string): Promise<void> {
    if (!this.agent) return;
    const state = this.sessions.get(sessionKey);
    if (!state) return;

    this.logger.debug('closeSessionSpan_start', {
      sessionKey,
      hasAgentRun: !!state.agentRunSpanId,
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
    this.logger.debug('session_span_closed', { sessionKey, spanId });
    this.sessions.delete(sessionKey);
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
      state.sessionSpanId  // Parent is session (not interaction)
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
      this.logger.debug('user_message_span_created', { sessionKey, spanId });
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
    
    this.logger.debug('user_message_span_closed', { sessionKey, spanId });
  }

  // Agent run spans
  async createAgentRunSpan(
    sessionKey: string,
    payload: { 
      messageCount: number;
      startTime: number;
      model?: string;
      provider?: string;
      temperature?: number;
      systemPromptHash?: string;
    }
  ): Promise<string | null> {
    if (!this.agent) return null;
    const state = this.getOrCreateSessionState(sessionKey);
    
    const spanId = await this.agent.createSpan(
      sessionKey,
      'pi:agent_run',
      payload,
      state.userMessageSpanId  // Parent is user_message (not interaction)
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
      this.logger.debug('agent_run_span_created', { sessionKey, spanId });
    }
    return spanId;
  }

  async closeAgentRunSpan(
    sessionKey: string,
    status: 'complete' | 'failed' | 'cancelled' = 'complete',
    resultPayload?: Record<string, unknown>
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
    
    // P0 Critical Fix #3: Add duration if we have start time
    const finalPayload = resultPayload ? { ...resultPayload } : {};
    if (state.agentRunStartTime && resultPayload?.endTime) {
      const endTime = resultPayload.endTime as number;
      finalPayload.durationMs = endTime - state.agentRunStartTime;
    }
    
    this.logger.debug('agent_run_closing', { sessionKey, spanId, status });
    await this.agent.finishSpan(sessionKey, spanId, status, finalPayload);
    this.logger.debug('agent_run_span_closed', { sessionKey, spanId, status });
  }

  // Tool call spans
  async createToolCallSpan(
    sessionKey: string,
    toolName: string,
    payload: Record<string, unknown>,
    schemaName: 'pi:tool:bash' | 'pi:tool:read' | 'pi:tool:write' | 'pi:tool:edit' | 'pi:tool_call' = 'pi:tool_call'
  ): Promise<string | null> {
    if (!this.agent) return null;
    const state = this.getOrCreateSessionState(sessionKey);
    
    // Parent is always agent_run (no turn spans anymore)
    const parentSpanId = state.agentRunSpanId;
    
    // Create span promise and track it
    const spanPromise = this.agent.createSpan(
      sessionKey,
      schemaName,
      payload,
      parentSpanId
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
        schemaName,
        createdAt: Date.now(),
        status: 'open',
      });
      this.logger.debug('tool_call_span_created', { sessionKey, spanId, toolName, schemaName });
    }
    return spanId;
  }

  async closeToolCallSpanWithResult(
    sessionKey: string,
    toolCallId: string,
    toolName: string,
    resultText: string | undefined,
    isError: boolean,
    resultPayload?: Record<string, unknown>
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

    // Merge resultText into resultPayload if provided
    const finalPayload = resultPayload ? { ...resultPayload, output: resultText || '' } : { output: resultText || '', isError };
    const status = isError ? 'failed' : 'complete';
    
    // Mark as closed in openSpans map
    const spanEntry = state.openSpans.get(entry.spanId);
    if (spanEntry) {
      spanEntry.status = 'closed';
    }
    
    this.logger.debug('tool_call_closing', { sessionKey, spanId: entry.spanId, isError, toolName });
    await this.agent.finishSpan(sessionKey, entry.spanId, status, finalPayload);
    this.logger.debug('tool_call_span_closed', { sessionKey, spanId: entry.spanId, status });
    
    state.toolCallSpans = state.toolCallSpans.filter(e => e.spanId !== entry.spanId);
  }

  // Assistant response spans - REMOVED (redundant with agent_run)
  // Thinking spans - REMOVED (low debugging value)

  // Cleanup methods for removed spans - NOOPs
  async closeInteractionSpan(_sessionKey: string): Promise<void> {
    // Removed: pi:user_interaction span no longer exists
    return Promise.resolve();
  }

  async closeAssistantResponseSpan(_sessionKey: string): Promise<void> {
    // Removed: pi:assistant_response span no longer exists
    return Promise.resolve();
  }

  async closeAgentThinkingSpan(_sessionKey: string): Promise<void> {
    // Removed: pi:agent_thinking span no longer exists
    return Promise.resolve();
  }

  async closeTurnSpan(_sessionKey: string, _turnIndex: number, _resultPayload?: Record<string, unknown>): Promise<void> {
    // Removed: pi:turn span no longer exists
    return Promise.resolve();
  }

  /**
   * Close all remaining open spans with specified status.
   * This is a defensive cleanup for spans not closed by their handlers.
   * P0 Critical Fix: Skip agent_run span - it will be closed by agent_end handler.
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
    
    this.logger.debug('closing_all_open_spans', {
      sessionKey,
      openSpanCount,
      defaultStatus,
    });
    
    // Close in reverse order (LIFO - newest first)
    // P0 Critical Fix: Skip agent_run span - agent_end handler will close it with proper data
    const openSpans = Array.from(state.openSpans.values())
      .filter(entry => entry.status === 'open' && entry.schemaName !== 'pi:agent_run')
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
    
    this.logger.debug('all_open_spans_closed', {
      sessionKey,
      closedCount: openSpans.length,
    });
  }

  /**
   * Get the count of active sessions.
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get session state for activity tracking (P0 Critical Fix #4, #5).
   */
  getSessionState(sessionKey: string): SessionSpanState | undefined {
    return this.sessions.get(sessionKey);
  }

  // Cleanup
  async cleanupAllSessions(): Promise<void> {
    this.logger.debug('cleanup_all_sessions_start', { count: this.sessions.size });
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
    this.logger.debug('cleanup_all_sessions_complete');
  }

  private async closeAllChildSpans(sessionKey: string): Promise<void> {
    const state = this.sessions.get(sessionKey);
    if (!state || !this.agent) return;

    this.logger.debug('closeAllChildSpans_start', {
      sessionKey,
      hasAgentRun: !!state.agentRunSpanId,
      toolCallCount: state.toolCallSpans.length,
      openSpanCount: Array.from(state.openSpans.values()).filter(e => e.status === 'open').length,
    });

    // Close any remaining open spans with 'complete' status
    const openSpans = Array.from(state.openSpans.values())
      .filter(entry => entry.status === 'open' && entry.schemaName !== 'pi:agent_run')
      .sort((a, b) => b.createdAt - a.createdAt);  // Newest first
    
    for (const entry of openSpans) {
      this.logger.debug('closing_missed_span', {
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

    // Close session span if still tracked (shouldn't happen, but defensive)
    if (state.sessionSpanId) {
      this.logger.warn('closing_session_span', {
        sessionKey,
        spanId: state.sessionSpanId,
      });
      await this.agent.finishSpan(
        sessionKey,
        state.sessionSpanId,
        'complete',
        { reason: 'child_cleanup' }
      );
      state.sessionSpanId = null;
    }

    // Clear other tracking arrays (these are just references, spans already closed)
    state.toolCallSpans = [];
    state.userMessageSpanId = null;
    
    this.logger.debug('closeAllChildSpans_complete', {
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
