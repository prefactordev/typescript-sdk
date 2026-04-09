/**
 * Agent HTTP client for pi-prefactor extension
 * Manages AgentInstance lifecycle and span CRUD via Prefactor API
 * Multi-session support - tracks multiple independent AgentInstances simultaneously
 * 
 * @module
 */

import {
  AgentInstanceClient,
  AgentSpanClient,
  type AgentSpanCreatePayload,
  HttpClient,
  type HttpTransportConfig,
} from '@prefactor/core';
import packageJson from '../package.json' with { type: 'json' };
import type { Logger } from './logger.js';

const SDK_HEADER_ENTRY = `${packageJson.name}@${packageJson.version}`;

// Session state tracking
interface SessionState {
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

// Span type schema for registration
interface SpanTypeSchema {
  name: string;
  params_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
  };
  result_schema?: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
  };
  template?: string | null;
  result_template?: string | null;
  description?: string;
}

interface AgentSchemaVersionForRegister extends Record<string, unknown> {
  external_identifier: string;
  span_type_schemas: SpanTypeSchema[];
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
      result_payload?: Record<string, unknown>;
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

// Replay queue for failed operations
class ReplayQueue {
  private queue: SpanOperation[] = [];
  private maxSize = 1000;

  add(operation: SpanOperation): void {
    if (this.queue.length >= this.maxSize) {
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

/**
 * Configuration for the Prefactor Agent HTTP client.
 */
export interface AgentConfig {
  apiUrl: string;
  apiToken: string;
  agentId: string;
  maxRetries?: number;
  initialRetryDelay?: number;
  requestTimeout?: number;
  piVersion?: string;
  pluginVersion?: string;
  userAgentVersion?: string;
  userAgentName?: string;
}

/**
 * HTTP client that manages AgentInstance lifecycle and span CRUD against the
 * Prefactor API. Supports multiple concurrent sessions.
 */
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

    const httpClient = new HttpClient(httpConfig, {}, SDK_HEADER_ENTRY);
    this.agentInstanceClient = new AgentInstanceClient(httpClient);
    this.agentSpanClient = new AgentSpanClient(httpClient);

    // Build version identifiers
    const piVersion = config.piVersion || 'unknown';
    const pluginVersion = config.pluginVersion || packageJson.version || '0.0.0';
    const userVersion = config.userAgentVersion || 'default';

    const agentName = config.userAgentName || 'Pi Agent';
    this.agentVersion = {
      external_identifier: `pi-${piVersion}-plugin-${pluginVersion}-${userVersion}`,
      name: agentName,
      description: `${agentName} — Pi ${piVersion} with Prefactor Plugin ${pluginVersion}`,
    } satisfies AgentVersionForRegister;

    // Define pi span type schemas for MVP
    this.agentSchemaVersion = {
      external_identifier: `plugin-${pluginVersion}`,
      span_type_schemas: [
        {
          name: 'pi:session',
          description: 'Pi session span',
          template: null,
          params_schema: {
            type: 'object',
            properties: {
              createdAt: { type: 'string', description: 'Session created timestamp' },
            },
          },
        },
        {
          name: 'pi:user_interaction',
          description: 'User interaction span',
          template: null,
          params_schema: {
            type: 'object',
            properties: {
              startedAt: { type: 'string', description: 'User interaction timestamp' },
            },
          },
        },
        {
          name: 'pi:user_message',
          description: 'Inbound user message',
          template: '{{ text | default: "(no message)" }}',
          params_schema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'User message text' },
              timestamp: { type: 'string', description: 'Message timestamp' },
            },
          },
        },
        {
          name: 'pi:agent_run',
          description: 'Agent execution run',
          template: null,
          params_schema: {
            type: 'object',
            properties: {
              messageCount: { type: 'number', description: 'Number of messages' },
            },
          },
        },
        {
          name: 'pi:tool_call',
          description: 'Tool execution',
          template: '{{ toolName | default: "(unknown tool)" }}',
          params_schema: {
            type: 'object',
            properties: {
              toolName: { type: 'string', description: 'Tool name' },
              toolCallId: { type: 'string', description: 'Tool call ID' },
              input: { type: 'object', description: 'Tool input parameters' },
            },
          },
          result_schema: {
            type: 'object',
            properties: {
              output: { type: 'string', description: 'Tool output' },
              isError: { type: 'boolean', description: 'Whether tool failed' },
            },
          },
        },
        {
          name: 'pi:assistant_response',
          description: 'Assistant response',
          template: '{{ text | default: "(no response)" }}',
          params_schema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Response text' },
            },
          },
        },
      ],
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
    this.flushInterval = setInterval(() => {
      this.flushQueue().catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        this.logger.error('flush_queue_failed', { error });
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
    this.stop();
    this.sessions.clear();
    this.replayQueue.clear();
    this.logger.info('emergency_cleanup_complete');
    return Promise.resolve();
  }

  private async registerAgentInstance(sessionKey: string): Promise<string | null> {
    const session = this.getOrCreateSession(sessionKey);

    if (session.instanceRegistered) {
      return session.instanceId;
    }

    try {
      const idempotencyKey = crypto.randomUUID();
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

      this.logger.info('agent_instance_registered', { sessionKey, instanceId });

      await this.startAgentInstance(sessionKey);

      return instanceId;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('register_agent_instance_failed', { sessionKey, error });

      const idempotencyKey = crypto.randomUUID();
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
      const idempotencyKey = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      this.logger.debug('start_agent_instance', { sessionKey, instanceId: session.instanceId });

      await this.agentInstanceClient.start(session.instanceId, {
        timestamp,
        idempotency_key: idempotencyKey,
      });
      session.instanceStarted = true;

      this.logger.info('agent_instance_started', { sessionKey, instanceId: session.instanceId });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('start_agent_instance_failed', {
        sessionKey,
        instanceId: session.instanceId,
        error,
      });

      const idempotencyKey = crypto.randomUUID();
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

    try {
      const idempotencyKey = crypto.randomUUID();
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
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('finish_agent_instance_failed', {
        sessionKey,
        instanceId: session.instanceId,
        error,
      });

      const idempotencyKey = crypto.randomUUID();
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

    if (!session.instanceRegistered) {
      const instanceId = await this.registerAgentInstance(sessionKey);
      if (!instanceId) {
        this.logger.error('cannot_create_span_no_instance', { sessionKey, schemaName });
        return null;
      }
    }

    const clientSpanId = `span-${sessionKey}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    try {
      const idempotencyKey = crypto.randomUUID();

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

      this.logger.info('span_created', { sessionKey, spanId, schemaName });

      return spanId;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('create_span_failed', {
        sessionKey,
        clientSpanId,
        schemaName,
        error: errorMsg,
      });

      return null;
    }
  }

  async finishSpan(
    sessionKey: string,
    spanId: string,
    status: 'complete' | 'failed' | 'cancelled' = 'complete',
    resultPayload?: Record<string, unknown>
  ): Promise<void> {
    try {
      const idempotencyKey = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      this.logger.debug('finish_span', { sessionKey, spanId, status, resultPayload });

      await this.agentSpanClient.finish(spanId, timestamp, {
        status,
        idempotency_key: idempotencyKey,
        result_payload: resultPayload,
      });

      this.logger.info('span_finished', { sessionKey, spanId, status });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('finish_span_failed', { sessionKey, spanId, error });

      const idempotencyKey = crypto.randomUUID();
      this.replayQueue.add({
        type: 'finish_span',
        sessionKey,
        spanId,
        timestamp: new Date().toISOString(),
        status,
        idempotency_key: idempotencyKey,
        result_payload: resultPayload,
      });
    }
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
              result_payload: operation.result_payload,
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
        const error = err instanceof Error ? err.message : String(err);
        this.logger.debug('flush_queue_operation_failed', {
          type: operation.type,
          sessionKey: operation.sessionKey,
          error,
        });
      }
    }

    const remaining = this.replayQueue.getAll().length;
    this.logger.debug('flush_queue_complete', {
      processed: operations.length - remaining,
      remaining,
    });
  }
}

/**
 * Creates and returns a fully initialised Agent instance.
 */
export function createAgent(config: AgentConfig, logger: Logger): Agent {
  return new Agent(config, logger);
}
