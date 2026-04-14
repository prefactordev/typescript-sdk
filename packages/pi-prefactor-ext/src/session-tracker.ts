/**
 * Session Tracker for pi-prefactor-ext
 *
 * Tracks session state: session ID, instance ID, agent run span ID, user request, etc.
 * Provides methods to manage session lifecycle and retrieve stored state.
 *
 * @module
 */

import type { Logger } from './logger.js';

/**
 * Session state data structure
 */
interface SessionState {
  sessionId: string | null;
  instanceId: string | null;
  agentRunSpanId: string | null;
  sessionSpanId: string | null;
  userRequest: string | null;
  startTime: number | null;
  endTime: number | null;
  status: 'idle' | 'active' | 'ended';
  // Per-message thinking state
  thinkingSpanId: string | null;
  thinkingStartTime: number | null;
  // Per-agent-run timing
  agentRunStartTime: number | null;
}

/**
 * Session Tracker interface
 */
export interface SessionTracker {
  startSession(sessionId: string): void;
  startInstance(instanceId: string): void;
  setAgentRunSpan(spanId: string): void;
  setSessionSpanId(spanId: string): void;
  getSessionSpanId(): string | null;
  setUserRequest(request: string): void;
  getUserRequest(): string | null;
  getAgentRunSpanId(): string | null;
  getInstanceId(): string | null;
  endSession(): void;
  getStartTime(): number | null;
  getSessionId(): string | null;
  isActive(): boolean;
  /** Set the thinking span ID for the current assistant message */
  setThinkingSpanId(spanId: string | null): void;
  /** Get the thinking span ID for the current assistant message */
  getThinkingSpanId(): string | null;
  /** Set the thinking start time (ms since epoch) for duration calculation */
  setThinkingStartTime(time: number | null): void;
  /** Get the thinking start time for duration calculation */
  getThinkingStartTime(): number | null;
  /** Set the agent run start time (ms since epoch) for duration calculation */
  setAgentRunStartTime(time: number): void;
  /** Get the agent run start time for duration calculation */
  getAgentRunStartTime(): number | null;
}

/**
 * Session Tracker implementation
 *
 * Features:
 * - Track session/instance ID
 * - Store user request for agent_run payload
 * - Track agent_run span ID
 * - Reset state between sessions
 */
export class SessionTrackerImpl implements SessionTracker {
  private logger: Logger;
  private state: SessionState;

  constructor(logger: Logger) {
    this.logger = logger;
    this.state = {
      sessionId: null,
      instanceId: null,
      agentRunSpanId: null,
      sessionSpanId: null,
      userRequest: null,
      startTime: null,
      endTime: null,
      status: 'idle',
      thinkingSpanId: null,
      thinkingStartTime: null,
      agentRunStartTime: null,
    };

    logger.debug('session_tracker_init');
  }

  /**
   * Start a new session
   *
   * @param sessionId - Unique session identifier
   */
  startSession(sessionId: string): void {
    const now = Date.now();

    this.state = {
      sessionId,
      instanceId: null,
      agentRunSpanId: null,
      sessionSpanId: null,
      userRequest: null,
      startTime: now,
      endTime: null,
      status: 'active',
      thinkingSpanId: null,
      thinkingStartTime: null,
      agentRunStartTime: null,
    };

    this.logger.info('session_started', { sessionId, startTime: now });
  }

  /**
   * Set the agent instance ID
   *
   * @param instanceId - Instance ID from Prefactor API
   */
  startInstance(instanceId: string): void {
    this.state.instanceId = instanceId;
    this.logger.debug('instance_set', { instanceId });
  }

  /**
   * Set the agent_run span ID
   *
   * @param spanId - Span ID from Prefactor API
   */
  setAgentRunSpan(spanId: string): void {
    this.state.agentRunSpanId = spanId;
    this.logger.debug('agent_run_span_set', { spanId });
  }

  /**
   * Set the session span ID
   *
   * @param spanId - Session span ID from Prefactor API
   */
  setSessionSpanId(spanId: string): void {
    this.state.sessionSpanId = spanId;
    this.logger.debug('session_span_set', { spanId });
  }

  /**
   * Get the current session span ID
   *
   * @returns Span ID or null if not set
   */
  getSessionSpanId(): string | null {
    return this.state.sessionSpanId;
  }

  /**
   * Store the user request for agent_run payload
   *
   * @param request - User request text
   */
  setUserRequest(request: string): void {
    this.state.userRequest = request;
    this.logger.debug('user_request_set', { requestPreview: request.slice(0, 50) });
  }

  /**
   * Get the stored user request
   *
   * @returns User request text or null if not set
   */
  getUserRequest(): string | null {
    return this.state.userRequest;
  }

  /**
   * Get the current agent_run span ID
   *
   * @returns Span ID or null if not set
   */
  getAgentRunSpanId(): string | null {
    return this.state.agentRunSpanId;
  }

  /**
   * Get the current instance ID
   *
   * @returns Instance ID or null if not set
   */
  getInstanceId(): string | null {
    return this.state.instanceId;
  }

  /**
   * Get the session start timestamp
   *
   * @returns Start time in milliseconds or null if not set
   */
  getStartTime(): number | null {
    return this.state.startTime;
  }

  /**
   * Get the session ID
   *
   * @returns Session ID or null if not set
   */
  getSessionId(): string | null {
    return this.state.sessionId;
  }

  /**
   * Check if session is currently active
   *
   * @returns true if session is active
   */
  isActive(): boolean {
    return this.state.status === 'active';
  }

  /**
   * End the current session and reset all state
   */
  endSession(): void {
    const now = Date.now();

    this.logger.info('session_ended', {
      sessionId: this.state.sessionId,
      startTime: this.state.startTime,
      endTime: now,
      duration: this.state.startTime ? now - this.state.startTime : null,
    });

    // Reset all state
    this.state = {
      sessionId: null,
      instanceId: null,
      agentRunSpanId: null,
      sessionSpanId: null,
      userRequest: null,
      startTime: null,
      endTime: now,
      status: 'ended',
      thinkingSpanId: null,
      thinkingStartTime: null,
      agentRunStartTime: null,
    };
  }

  /**
   * Set the thinking span ID for the current assistant message
   *
   * @param spanId - Thinking span ID or null to clear
   */
  setThinkingSpanId(spanId: string | null): void {
    this.state.thinkingSpanId = spanId;
    this.logger.debug('thinking_span_set', { spanId });
  }

  /**
   * Get the thinking span ID for the current assistant message
   *
   * @returns Thinking span ID or null
   */
  getThinkingSpanId(): string | null {
    return this.state.thinkingSpanId;
  }

  /**
   * Set the thinking start time for duration calculation
   *
   * @param time - Start time in ms since epoch, or null to clear
   */
  setThinkingStartTime(time: number | null): void {
    this.state.thinkingStartTime = time;
  }

  /**
   * Get the thinking start time
   *
   * @returns Start time in ms since epoch, or null
   */
  getThinkingStartTime(): number | null {
    return this.state.thinkingStartTime;
  }

  /**
   * Set the agent run start time for duration calculation
   *
   * @param time - Start time in ms since epoch
   */
  setAgentRunStartTime(time: number): void {
    this.state.agentRunStartTime = time;
  }

  /**
   * Get the agent run start time
   *
   * @returns Start time in ms since epoch, or null
   */
  getAgentRunStartTime(): number | null {
    return this.state.agentRunStartTime;
  }

  /**
   * Get current session state (for debugging)
   *
   * @returns Current state snapshot
   */
  getState(): SessionState {
    return { ...this.state };
  }
}

/**
 * Create a Session Tracker instance
 *
 * @param logger - Logger instance
 * @returns Session Tracker instance
 */
export function createSessionTracker(logger: Logger): SessionTracker {
  return new SessionTrackerImpl(logger);
}
