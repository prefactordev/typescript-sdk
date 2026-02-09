import type { HttpTransportConfig } from '../config.js';
import { InMemoryQueue } from '../queue/in-memory-queue.js';
import type { TransportAction } from '../queue/actions.js';
import { TaskExecutor } from '../queue/task-executor.js';
import type { Span } from '../tracing/span.js';
import { getLogger } from '../utils/logging.js';
import { AgentInstanceClient } from './http/agent-instance-client.js';
import {
  AgentSpanClient,
  type AgentSpanCreatePayload,
  type AgentSpanStatus,
} from './http/agent-span-client.js';
import { HttpClient } from './http/http-client.js';

export type AgentInstanceOptions = {
  agentId?: string;
  agentIdentifier?: string;
  agentName?: string;
  agentDescription?: string;
};

export interface Transport {
  emit(span: Span): void;

  finishSpan(spanId: string, endTime: number): void;

  startAgentInstance(options?: AgentInstanceOptions): void;

  finishAgentInstance(): void;

  registerSchema(schema: Record<string, unknown>): void;

  close(): void | Promise<void>;
}

const logger = getLogger('http-transport');

export class HttpTransport implements Transport {
  private closed = false;
  private readonly actionQueue = new InMemoryQueue<TransportAction>();
  private readonly taskExecutor: TaskExecutor<TransportAction>;
  private readonly agentInstanceClient: AgentInstanceClient;
  private readonly agentSpanClient: AgentSpanClient;
  private previousAgentSchema: string | null = null;
  private requiresNewAgentIdentifier = false;
  private previousAgentIdentifier: string | null = null;
  private agentInstanceId: string | null = null;
  private spanIdMap = new Map<string, string>();
  private pendingFinishes = new Map<string, number>();

  constructor(private config: HttpTransportConfig) {
    const httpClient = new HttpClient(config);
    this.agentInstanceClient = new AgentInstanceClient(httpClient);
    this.agentSpanClient = new AgentSpanClient(httpClient);
    this.taskExecutor = new TaskExecutor(this.actionQueue, this.processAction, {
      workerCount: 1,
      onError: async (error) => {
        logger.error('Error processing HTTP action:', error);
      },
    });
    this.taskExecutor.start();
  }

  registerSchema(schema: Record<string, unknown>): void {
    this.enqueue({ type: 'schema_register', schema });
  }

  startAgentInstance(options?: AgentInstanceOptions): void {
    this.enqueue({ type: 'agent_start', options });
  }

  finishAgentInstance(): void {
    this.enqueue({ type: 'agent_finish' });
  }

  emit(span: Span): void {
    this.enqueue({ type: 'span_end', span });
  }

  finishSpan(spanId: string, endTime: number): void {
    this.enqueue({ type: 'span_finish', spanId, endTime });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.taskExecutor.stop();
    if (this.pendingFinishes.size > 0) {
      logger.warn(
        `Transport closed with ${this.pendingFinishes.size} pending span finish(es) that could not be processed`
      );
      this.pendingFinishes.clear();
    }
  }

  private enqueue(action: TransportAction): void {
    if (this.closed) {
      return;
    }

    this.actionQueue.put(action).catch((error: unknown) => {
      logger.error('Failed to enqueue HTTP action:', error);
    });
  }

  private processAction = async (action: TransportAction): Promise<void> => {
    switch (action.type) {
      case 'schema_register': {
        const incomingSchema = JSON.stringify(action.schema);
        if (this.previousAgentSchema !== null && this.previousAgentSchema !== incomingSchema) {
          this.requiresNewAgentIdentifier = true;
          this.previousAgentIdentifier = this.config.agentIdentifier;
          this.agentInstanceId = null;
        }
        this.previousAgentSchema = incomingSchema;
        this.config.agentSchema = action.schema;
        return;
      }
      case 'agent_start': {
        if (this.requiresNewAgentIdentifier) {
          const nextAgentIdentifier = action.options?.agentIdentifier;
          if (
            nextAgentIdentifier === undefined ||
            nextAgentIdentifier === this.previousAgentIdentifier
          ) {
            logger.error('Schema changed; starting an agent requires a new agentIdentifier value.');
            return;
          }

          this.requiresNewAgentIdentifier = false;
          this.previousAgentIdentifier = null;
        }

        if (action.options?.agentId !== undefined) this.config.agentId = action.options.agentId;
        if (action.options?.agentIdentifier !== undefined) {
          this.config.agentIdentifier = action.options.agentIdentifier;
        }
        if (action.options?.agentName !== undefined)
          this.config.agentName = action.options.agentName;
        if (action.options?.agentDescription !== undefined) {
          this.config.agentDescription = action.options.agentDescription;
        }

        await this.startAgentInstanceHttp();
        return;
      }
      case 'agent_finish':
        await this.finishAgentInstanceHttp();
        return;
      case 'span_end':
        if (!this.agentInstanceId) {
          await this.ensureAgentRegistered();
        }
        await this.sendSpan(action.span);
        return;
      case 'span_finish': {
        const backendSpanId = this.spanIdMap.get(action.spanId);
        if (backendSpanId) {
          const timestamp = new Date(action.endTime).toISOString();
          await this.finishSpanHttp({ spanId: action.spanId, timestamp });
        } else {
          this.pendingFinishes.set(action.spanId, action.endTime);
        }
        return;
      }
    }
  };

  private async processPendingFinishes(spanId: string): Promise<void> {
    if (!this.pendingFinishes.has(spanId)) {
      return;
    }

    const pendingEndTime = this.pendingFinishes.get(spanId);
    if (pendingEndTime === undefined) {
      return;
    }

    try {
      const timestamp = new Date(pendingEndTime).toISOString();
      await this.finishSpanHttp({ spanId, timestamp });
      this.pendingFinishes.delete(spanId);
    } catch (error) {
      logger.error('Error processing pending span finish:', error);
    }
  }

  private async sendSpan(span: Span): Promise<void> {
    const payload = this.transformSpanToApiFormat(span);

    try {
      const response = await this.agentSpanClient.create(payload);
      const backendSpanId = response.details?.id;
      if (!backendSpanId) {
        return;
      }

      this.spanIdMap.set(span.spanId, backendSpanId);
      await this.processPendingFinishes(span.spanId);
    } catch (error) {
      logger.error('Error sending span:', error);
    }
  }

  private transformSpanToApiFormat(span: Span): AgentSpanCreatePayload {
    const startedAt = new Date(span.startTime).toISOString();
    const finishedAt = span.endTime ? new Date(span.endTime).toISOString() : null;
    const apiStatus = this.mapStatusForApi(span.status);

    const payload: Record<string, unknown> = {
      span_id: span.spanId,
      trace_id: span.traceId,
      name: span.name,
      status: apiStatus,
      inputs: span.inputs,
      outputs: span.outputs,
      metadata: span.metadata,
      token_usage: null,
      error: null,
    };

    if (span.tokenUsage) {
      payload.token_usage = {
        prompt_tokens: span.tokenUsage.promptTokens,
        completion_tokens: span.tokenUsage.completionTokens,
        total_tokens: span.tokenUsage.totalTokens,
      };
    }

    if (span.error) {
      payload.error = {
        error_type: span.error.errorType,
        message: span.error.message,
        stacktrace: span.error.stacktrace,
      };
    }

    const parentSpanId = span.parentSpanId ? (this.spanIdMap.get(span.parentSpanId) ?? null) : null;

    return {
      details: {
        agent_instance_id: this.agentInstanceId,
        schema_name: span.spanType,
        status: apiStatus,
        payload,
        parent_span_id: parentSpanId,
        started_at: startedAt,
        finished_at: finishedAt,
      },
    };
  }

  private mapStatusForApi(status: Span['status']): AgentSpanStatus {
    switch (status) {
      case 'running':
        return 'active';
      case 'success':
        return 'complete';
      case 'error':
        return 'failed';
      default:
        return 'active';
    }
  }

  private async ensureAgentRegistered(): Promise<boolean> {
    if (this.agentInstanceId) {
      return true;
    }

    const payload: Record<string, unknown> = {};

    if (this.config.agentId) payload.agent_id = this.config.agentId;
    if (this.config.agentIdentifier) {
      payload.agent_version = {
        external_identifier: this.config.agentIdentifier,
        name: this.config.agentName || 'Agent',
        description: this.config.agentDescription || '',
      };
    }

    if (this.config.agentSchema) {
      payload.agent_schema_version = this.config.agentSchema;
    }

    try {
      const data = await this.agentInstanceClient.register(payload);
      this.agentInstanceId = data.details?.id ?? null;
    } catch (error) {
      logger.error('Error registering agent:', error);
    }

    return this.agentInstanceId !== null;
  }

  private async startAgentInstanceHttp(): Promise<void> {
    const isRegistered = await this.ensureAgentRegistered();
    if (!isRegistered || !this.agentInstanceId) {
      logger.error('Cannot start agent instance: not registered');
      return;
    }

    try {
      await this.agentInstanceClient.start(this.agentInstanceId);
    } catch (error) {
      logger.error('Error starting agent instance:', error);
    }
  }

  private async finishAgentInstanceHttp(): Promise<void> {
    if (!this.agentInstanceId) {
      logger.error('Cannot finish agent instance: not registered');
      return;
    }

    try {
      await this.agentInstanceClient.finish(this.agentInstanceId);
    } catch (error) {
      logger.error('Error finishing agent instance:', error);
    }

    this.agentInstanceId = null;
  }

  private async finishSpanHttp(data: { spanId: string; timestamp: string }): Promise<void> {
    const backendSpanId = this.spanIdMap.get(data.spanId);
    if (!backendSpanId) {
      logger.warn(`Cannot finish span ${data.spanId}: backend ID not found`);
      return;
    }

    try {
      await this.agentSpanClient.finish(backendSpanId, data.timestamp);
    } catch (error) {
      logger.error('Error finishing span:', error);
    }
  }
}
