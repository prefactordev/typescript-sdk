// Agent span management for Prefactor plugin
// Manages AgentInstance lifecycle and span tracking with stack-based hierarchy
// Multi-session support - tracks multiple independent AgentInstances simultaneously

import {
  AgentInstanceClient,
  AgentSpanClient,
  type AgentSpanCreatePayload,
  HttpClient,
  type HttpClientError,
  type HttpTransportConfig,
} from '@prefactor/core';
import type { Logger } from './logger.js';

// Session state tracking
interface SessionState {
  stack: SpanStack;
  instanceId: string | null;
  instanceRegistered: boolean;
  instanceStarted: boolean;
}

// Agent version info for registration
interface AgentVersionForRegister {
  external_identifier: string;
  name: string;
  description: string;
}

// Agent schema version info for registration
interface AgentSchemaVersionForRegister extends Record<string, unknown> {
  external_identifier: string;
  span_schemas: Record<string, unknown>;
}

// Operation types for replay queue
type SpanOperation =
  | { type: 'create_span'; sessionKey: string; spanId: string; request: AgentSpanCreatePayload }
  | {
      type: 'finish_span';
      sessionKey: string;
      spanId: string;
      timestamp: string;
      status: string;
      idempotency_key: string;
    }
  | {
      type: 'register_instance';
      sessionKey: string;
      instanceId: string;
      request: {
        agent_id: string;
        agent_version: AgentVersionForRegister;
        agent_schema_version: AgentSchemaVersionForRegister;
        idempotency_key?: string;
      };
    }
  | {
      type: 'start_instance';
      sessionKey: string;
      instanceId: string;
      timestamp: string;
      idempotency_key: string;
    }
  | {
      type: 'finish_instance';
      sessionKey: string;
      instanceId: string;
      status: string;
      timestamp: string;
      idempotency_key: string;
    };

// Active span tracking
interface ActiveSpan {
  spanId: string;
  schemaName: string;
  startedAt: string;
  sessionKey: string;
}

// Span stack for single session
class SpanStack {
  private spans: ActiveSpan[] = [];

  push(span: ActiveSpan): void {
    this.spans.push(span);
  }

  pop(): ActiveSpan | undefined {
    return this.spans.pop();
  }

  peek(): ActiveSpan | undefined {
    return this.spans[this.spans.length - 1];
  }

  findBySchema(schemaName: string): ActiveSpan | undefined {
    for (let i = this.spans.length - 1; i >= 0; i--) {
      if (this.spans[i].schemaName === schemaName) {
        return this.spans[i];
      }
    }
    return undefined;
  }

  getAll(): ActiveSpan[] {
    return [...this.spans];
  }

  clear(): void {
    this.spans = [];
  }

  isEmpty(): boolean {
    return this.spans.length === 0;
  }
}

// Replay queue for failed operations
class ReplayQueue {
  private queue: SpanOperation[] = [];
  private maxSize = 1000;

  add(operation: SpanOperation): void {
    if (this.queue.length >= this.maxSize) {
      // Drop oldest operations
      this.queue.shift();
    }
    this.queue.push(operation);
  }

  getAll(): SpanOperation[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
  }

  remove(operation: SpanOperation): void {
    const index = this.queue.indexOf(operation);
    if (index > -1) {
      this.queue.splice(index, 1);
    }
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}

// Agent configuration
export interface AgentConfig {
  apiUrl: string;
  apiToken: string;
  agentId: string;
  maxRetries?: number;
  initialRetryDelay?: number;
  requestTimeout?: number;
  openclawVersion?: string;
  pluginVersion?: string;
  userAgentVersion?: string;
}

export class Agent {
  private agentInstanceClient: AgentInstanceClient;
  private agentSpanClient: AgentSpanClient;
  private logger: Logger;
  private config: AgentConfig;
  private sessions: Map<string, SessionState> = new Map();
  private replayQueue: ReplayQueue = new ReplayQueue();
  private flushInterval: NodeJS.Timeout | null = null;
  private agentVersion: AgentVersionForRegister;
  private agentSchemaVersion: AgentSchemaVersionForRegister;

  constructor(config: AgentConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    const httpConfig: HttpTransportConfig = {
      apiUrl: config.apiUrl,
      apiToken: config.apiToken,
      agentId: config.agentId,
      agentIdentifier: 'v0.0.0',
      requestTimeout: config.requestTimeout ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      initialRetryDelay: config.initialRetryDelay ?? 1000,
      maxRetryDelay: 60000,
      retryMultiplier: 2.0,
      retryOnStatusCodes: [429, ...Array.from({ length: 100 }, (_, i) => 500 + i)],
    };

    const httpClient = new HttpClient(httpConfig);
    this.agentInstanceClient = new AgentInstanceClient(httpClient);
    this.agentSpanClient = new AgentSpanClient(httpClient);

    // Build version identifiers
    const openclawVersion = config.openclawVersion || 'unknown';
    const pluginVersion = config.pluginVersion || '0.0.0';
    const userVersion = config.userAgentVersion || 'default';

    this.agentVersion = {
      external_identifier: `openclaw-${openclawVersion}-plugin-${pluginVersion}-${userVersion}`,
      name: 'OpenClaw Agent',
      description: `OpenClaw ${openclawVersion} with Prefactor Plugin ${pluginVersion}`,
    } satisfies AgentVersionForRegister;

    this.agentSchemaVersion = {
      external_identifier: `plugin-${pluginVersion}`,
      span_schemas: {
        'openclaw:agent_run': {
          description: 'Agent execution run span',
          fields: {
            raw: { type: 'object', description: 'Raw OpenClaw context' },
          },
        },
        'openclaw:tool_call': {
          description: 'Tool execution span',
          fields: {
            toolName: { type: 'string', description: 'Name of the tool called' },
            raw: { type: 'object', description: 'Raw OpenClaw tool context' },
          },
        },
        'openclaw:user_message': {
          description: 'Inbound message from user',
          fields: {
            raw: { type: 'object', description: 'Raw OpenClaw message context' },
          },
        },
        'openclaw:assistant_message': {
          description: 'Outbound message to user',
          fields: {
            raw: { type: 'object', description: 'Raw OpenClaw message context' },
          },
        },
        'openclaw:assistant_response': {
          description: 'Assistant response generation span',
          fields: {
            raw: { type: 'object', description: 'Raw OpenClaw context with messages' },
          },
        },
      },
    };

    // Start background flush loop
    this.startFlushLoop();

    this.logger.info('agent_init', {
      agentId: config.agentId,
      agentVersion: this.agentVersion.external_identifier,
      schemaVersion: this.agentSchemaVersion.external_identifier,
    });
  }

  private getOrCreateSession(sessionKey: string): SessionState {
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, {
        stack: new SpanStack(),
        instanceId: null,
        instanceRegistered: false,
        instanceStarted: false,
      });
      this.logger.debug('session_created', { sessionKey });
    }
    const session = this.sessions.get(sessionKey);
    if (!session) {
      throw new Error(`Session ${sessionKey} not found after creation`);
    }
    return session;
  }

  private startFlushLoop(): void {
    // Flush every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flushQueue().catch((err) => {
        this.logger.error('flush_queue_failed', { error: err.message });
      });
    }, 30000);
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  emergencyCleanup(): Promise<void> {
    this.logger.info('emergency_cleanup_start', { sessionCount: this.sessions.size });

    // Stop the flush loop
    this.stop();

    // Clear all sessions
    this.sessions.clear();

    // Clear replay queue
    this.replayQueue.clear();

    this.logger.info('emergency_cleanup_complete', {});

    return Promise.resolve();
  }

  private async registerAgentInstance(sessionKey: string): Promise<string | null> {
    const session = this.getOrCreateSession(sessionKey);

    if (session.instanceRegistered) {
      return session.instanceId;
    }

    try {
      const idempotencyKey = `instance-${sessionKey}-${Date.now()}`;

      this.logger.debug('register_agent_instance', { sessionKey, idempotencyKey });

      const response = await this.agentInstanceClient.register({
        agent_id: this.config.agentId,
        agent_version: this.agentVersion,
        agent_schema_version: this.agentSchemaVersion,
        idempotency_key: idempotencyKey,
      });

      const instanceId = response.details?.id ?? null;
      session.instanceId = instanceId;
      session.instanceRegistered = true;

      this.logger.info('agent_instance_registered', {
        sessionKey,
        instanceId,
      });

      // Now start the instance
      await this.startAgentInstance(sessionKey);

      return instanceId;
    } catch (err) {
      this.logger.error('register_agent_instance_failed', {
        sessionKey,
        error: err instanceof Error ? err.message : String(err),
      });

      // Queue for retry
      const idempotencyKey = `instance-${sessionKey}-${Date.now()}`;
      this.replayQueue.add({
        type: 'register_instance',
        sessionKey,
        instanceId: '',
        request: {
          agent_id: this.config.agentId,
          agent_version: this.agentVersion,
          agent_schema_version: this.agentSchemaVersion,
          idempotency_key: idempotencyKey,
        },
      });

      return null;
    }
  }

  private async startAgentInstance(sessionKey: string): Promise<void> {
    const session = this.getOrCreateSession(sessionKey);

    if (!session.instanceId || session.instanceStarted) {
      return;
    }

    try {
      const idempotencyKey = `instance-start-${sessionKey}-${Date.now()}`;
      const timestamp = new Date().toISOString();

      this.logger.debug('start_agent_instance', { sessionKey, instanceId: session.instanceId });

      await this.agentInstanceClient.start(session.instanceId, {
        timestamp,
        idempotency_key: idempotencyKey,
      });
      session.instanceStarted = true;

      this.logger.info('agent_instance_started', {
        sessionKey,
        instanceId: session.instanceId,
      });
    } catch (err) {
      this.logger.error('start_agent_instance_failed', {
        sessionKey,
        instanceId: session.instanceId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Queue for retry
      const idempotencyKey = `instance-start-${sessionKey}-${Date.now()}`;
      this.replayQueue.add({
        type: 'start_instance',
        sessionKey,
        instanceId: session.instanceId,
        timestamp: new Date().toISOString(),
        idempotency_key: idempotencyKey,
      });
    }
  }

  async finishAgentInstance(
    sessionKey: string,
    status: 'complete' | 'failed' | 'cancelled' = 'complete'
  ): Promise<void> {
    const session = this.getOrCreateSession(sessionKey);

    if (!session.instanceId) {
      return;
    }

    // First, close all remaining spans
    await this.closeAllSpans(sessionKey);

    try {
      const idempotencyKey = `instance-finish-${sessionKey}-${Date.now()}`;
      const timestamp = new Date().toISOString();

      this.logger.debug('finish_agent_instance', {
        sessionKey,
        instanceId: session.instanceId,
        status,
      });

      await this.agentInstanceClient.finish(session.instanceId, {
        status,
        timestamp,
        idempotency_key: idempotencyKey,
      });

      this.logger.info('agent_instance_finished', {
        sessionKey,
        instanceId: session.instanceId,
        status,
      });
    } catch (err) {
      this.logger.error('finish_agent_instance_failed', {
        sessionKey,
        instanceId: session.instanceId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Queue for retry
      const idempotencyKey = `instance-finish-${sessionKey}-${Date.now()}`;
      this.replayQueue.add({
        type: 'finish_instance',
        sessionKey,
        instanceId: session.instanceId,
        status,
        timestamp: new Date().toISOString(),
        idempotency_key: idempotencyKey,
      });
    }
  }

  async createSpan(
    sessionKey: string,
    schemaName: string,
    payload: Record<string, unknown>,
    parentSpanId?: string | null
  ): Promise<string | null> {
    const session = this.getOrCreateSession(sessionKey);

    // Ensure we have an AgentInstance
    if (!session.instanceRegistered) {
      const instanceId = await this.registerAgentInstance(sessionKey);
      if (!instanceId) {
        this.logger.error('cannot_create_span_no_instance', { sessionKey, schemaName });
        return null;
      }
    }

    // Note: Span ID is generated by the server, not the client
    const clientSpanId = `span-${sessionKey}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      const idempotencyKey = `${clientSpanId}`;

      // Log instance details for debugging schema issues
      this.logger.info('create_span_instance_debug', {
        sessionKey,
        schemaName,
        instanceId: session.instanceId,
        instanceRegistered: session.instanceRegistered,
        instanceStarted: session.instanceStarted,
        clientSpanId,
        parentSpanId: parentSpanId || null,
      });

      if (!session.instanceId) {
        this.logger.error('cannot_create_span_no_instance_id', { sessionKey });
        return null;
      }

      const request: AgentSpanCreatePayload = {
        details: {
          agent_instance_id: session.instanceId,
          schema_name: schemaName,
          status: 'active',
          payload,
          parent_span_id: parentSpanId || null,
          started_at: new Date().toISOString(),
          finished_at: null,
        },
        idempotency_key: idempotencyKey,
      };

      this.logger.debug('create_span', {
        sessionKey,
        clientSpanId,
        schemaName,
        parentSpanId: parentSpanId || null,
      });

      const response = await this.agentSpanClient.create(request);
      const spanId = response.details?.id;

      if (!spanId) {
        this.logger.error('create_span_no_id', { sessionKey, schemaName });
        return null;
      }

      // Push to stack
      session.stack.push({
        spanId,
        schemaName,
        startedAt: response.details?.started_at || new Date().toISOString(),
        sessionKey,
      });

      this.logger.info('span_created', {
        sessionKey,
        spanId,
        schemaName,
      });

      return spanId;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Extract validation errors from HttpClientError response
      const httpErr = err as HttpClientError;
      const errorDetails = (httpErr?.responseBody as Record<string, unknown>)?.errors;
      this.logger.error('create_span_failed', {
        sessionKey,
        clientSpanId,
        schemaName,
        error: errorMsg,
        validationErrors: errorDetails ? JSON.stringify(errorDetails) : undefined,
        requestPayload: JSON.stringify(payload).slice(0, 500),
      });

      return null;
    }
  }

  async finishSpan(
    sessionKey: string,
    spanId: string,
    status: 'complete' | 'failed' | 'cancelled' = 'complete'
  ): Promise<void> {
    try {
      const idempotencyKey = `${spanId}-finish-${Date.now()}`;
      const timestamp = new Date().toISOString();

      this.logger.debug('finish_span', { sessionKey, spanId, status });

      await this.agentSpanClient.finish(spanId, timestamp, {
        status,
        idempotency_key: idempotencyKey,
      });

      // Remove from stack
      const session = this.getOrCreateSession(sessionKey);
      const spans = session.stack.getAll();
      const spanIndex = spans.findIndex((s) => s.spanId === spanId);
      if (spanIndex > -1) {
        // Remove this span and all children above it
        while (!session.stack.isEmpty()) {
          const popped = session.stack.pop();
          if (popped?.spanId === spanId) break;
        }
      }

      this.logger.info('span_finished', { sessionKey, spanId, status });
    } catch (err) {
      this.logger.error('finish_span_failed', {
        sessionKey,
        spanId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Queue for retry
      const idempotencyKey = `${spanId}-finish-${Date.now()}`;
      this.replayQueue.add({
        type: 'finish_span',
        sessionKey,
        spanId,
        timestamp: new Date().toISOString(),
        status,
        idempotency_key: idempotencyKey,
      });
    }
  }

  async closeAllSpans(sessionKey: string): Promise<void> {
    const session = this.getOrCreateSession(sessionKey);
    const spans = session.stack.getAll();

    // Finish spans in reverse order (LIFO)
    for (let i = spans.length - 1; i >= 0; i--) {
      await this.finishSpan(sessionKey, spans[i].spanId, 'complete');
    }

    session.stack.clear();
  }

  async closeSpanBySchema(sessionKey: string, schemaName: string): Promise<void> {
    const session = this.getOrCreateSession(sessionKey);
    const span = session.stack.findBySchema(schemaName);

    if (span) {
      await this.finishSpan(sessionKey, span.spanId, 'complete');
    }
  }

  getCurrentSpan(sessionKey: string): ActiveSpan | undefined {
    const session = this.getOrCreateSession(sessionKey);
    return session.stack.peek();
  }

  getParentSpanId(sessionKey: string): string | null {
    const current = this.getCurrentSpan(sessionKey);
    return current?.spanId || null;
  }

  async flushQueue(): Promise<void> {
    if (this.replayQueue.isEmpty()) {
      return;
    }

    const operations = this.replayQueue.getAll();
    this.logger.debug('flush_queue_start', { count: operations.length });

    for (const operation of operations) {
      try {
        switch (operation.type) {
          case 'create_span': {
            await this.agentSpanClient.create(operation.request);
            this.replayQueue.remove(operation);
            this.logger.debug('flush_queue_create_span_success', {
              sessionKey: operation.sessionKey,
              spanId: operation.spanId,
            });
            break;
          }
          case 'finish_span': {
            await this.agentSpanClient.finish(operation.spanId, operation.timestamp, {
              status: operation.status as 'complete' | 'failed' | 'cancelled',
              idempotency_key: operation.idempotency_key,
            });
            this.replayQueue.remove(operation);
            this.logger.debug('flush_queue_finish_span_success', {
              sessionKey: operation.sessionKey,
              spanId: operation.spanId,
            });
            break;
          }
          case 'register_instance': {
            const response = await this.agentInstanceClient.register(operation.request);
            this.replayQueue.remove(operation);
            this.logger.debug('flush_queue_register_instance_success', {
              sessionKey: operation.sessionKey,
              instanceId: response.details?.id,
            });
            break;
          }
          case 'start_instance': {
            await this.agentInstanceClient.start(operation.instanceId, {
              timestamp: operation.timestamp,
              idempotency_key: operation.idempotency_key,
            });
            this.replayQueue.remove(operation);
            this.logger.debug('flush_queue_start_instance_success', {
              sessionKey: operation.sessionKey,
              instanceId: operation.instanceId,
            });
            break;
          }
          case 'finish_instance': {
            await this.agentInstanceClient.finish(operation.instanceId, {
              status: operation.status as 'complete' | 'failed' | 'cancelled',
              timestamp: operation.timestamp,
              idempotency_key: operation.idempotency_key,
            });
            this.replayQueue.remove(operation);
            this.logger.debug('flush_queue_finish_instance_success', {
              sessionKey: operation.sessionKey,
              instanceId: operation.instanceId,
            });
            break;
          }
        }
      } catch (err) {
        // Keep in queue for next retry
        this.logger.debug('flush_queue_operation_failed', {
          type: operation.type,
          sessionKey: operation.sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const remaining = this.replayQueue.getAll().length;
    this.logger.debug('flush_queue_complete', {
      processed: operations.length - remaining,
      remaining,
    });
  }

  // Utility for creating spans with proper parent relationships
  async createAgentRunSpan(sessionKey: string, rawContext: unknown): Promise<string | null> {
    return this.createSpan(sessionKey, 'openclaw:agent_run', { raw: rawContext }, null);
  }

  async createToolCallSpan(
    sessionKey: string,
    toolName: string,
    rawContext: unknown
  ): Promise<string | null> {
    // First, close any existing tool_call span (workaround for broken after_tool_call)
    await this.closeSpanBySchema(sessionKey, 'openclaw:tool_call');

    const parentSpanId = this.getParentSpanId(sessionKey);
    return this.createSpan(
      sessionKey,
      'openclaw:tool_call',
      { toolName, raw: rawContext },
      parentSpanId
    );
  }

  async closeToolCallSpan(sessionKey: string): Promise<void> {
    await this.closeSpanBySchema(sessionKey, 'openclaw:tool_call');
  }

  async createUserMessageSpan(sessionKey: string, rawContext: unknown): Promise<string | null> {
    const parentSpanId = this.getParentSpanId(sessionKey);
    const spanId = await this.createSpan(
      sessionKey,
      'openclaw:user_message',
      { raw: rawContext },
      parentSpanId
    );

    // User message spans are instant - close immediately
    if (spanId) {
      await this.finishSpan(sessionKey, spanId, 'complete');
    }

    return spanId;
  }

  async createAssistantMessageSpan(
    sessionKey: string,
    rawContext: unknown
  ): Promise<string | null> {
    const parentSpanId = this.getParentSpanId(sessionKey);
    return this.createSpan(
      sessionKey,
      'openclaw:assistant_message',
      { raw: rawContext },
      parentSpanId
    );
  }

  async closeAssistantMessageSpan(sessionKey: string): Promise<void> {
    await this.closeSpanBySchema(sessionKey, 'openclaw:assistant_message');
  }
}

// Factory function
export function createAgent(config: AgentConfig, logger: Logger): Agent {
  return new Agent(config, logger);
}
