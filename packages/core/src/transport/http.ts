import type { HttpTransportConfig } from '../config.js';
import type { Span } from '../tracing/span.js';
import { getLogger } from '../utils/logging.js';
import type { AgentInstanceOptions, Transport } from './base.js';

const logger = getLogger('http-transport');

type Action =
  | { type: 'schema_register'; schema: Record<string, unknown> }
  | { type: 'agent_start'; options?: AgentInstanceOptions }
  | { type: 'agent_finish' }
  | { type: 'span_end'; span: Span }
  | { type: 'span_finish'; spanId: string; endTime: number };

export class HttpTransport implements Transport {
  private closed = false;
  private actionChain = Promise.resolve();
  private previousAgentSchema: string | null = null;
  private requiresNewAgentIdentifier = false;
  private previousAgentIdentifier: string | null = null;
  private agentInstanceId: string | null = null;
  private spanIdMap = new Map<string, string>();
  private pendingFinishes = new Map<string, number>();

  constructor(private config: HttpTransportConfig) {}

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
    await this.actionChain;
    if (this.pendingFinishes.size > 0) {
      logger.warn(
        `Transport closed with ${this.pendingFinishes.size} pending span finish(es) that could not be processed`
      );
      this.pendingFinishes.clear();
    }
  }

  private enqueue(action: Action): void {
    if (this.closed) {
      return;
    }

    this.actionChain = this.actionChain.then(async () => {
      try {
        await this.processAction(action);
      } catch (error) {
        logger.error('Error processing HTTP action:', error);
      }
    });
  }

  private async processAction(action: Action): Promise<void> {
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
  }

  private async processPendingFinishes(spanId: string): Promise<void> {
    const pendingEndTime = this.pendingFinishes.get(spanId);
    if (!pendingEndTime) {
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

  private async sendSpan(span: Span, retry = 0): Promise<void> {
    const url = `${this.config.apiUrl}/api/v1/agent_spans`;
    const payload = this.transformSpanToApiFormat(span);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.requestTimeout),
      });

      if (response.ok) {
        const data = (await response.json()) as { details?: { id?: string } };
        const backendSpanId = data?.details?.id;
        if (backendSpanId) {
          this.spanIdMap.set(span.spanId, backendSpanId);
          await this.processPendingFinishes(span.spanId);
        }
        return;
      }

      if ((response.status >= 500 || response.status === 429) && retry < this.config.maxRetries) {
        const delay = Math.min(
          this.config.initialRetryDelay * this.config.retryMultiplier ** retry,
          this.config.maxRetryDelay
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        await this.sendSpan(span, retry + 1);
        return;
      }

      logger.error(`Failed to send span: ${response.status} ${response.statusText}`);
      logger.debug(`Failed span response: ${await response.text()}`);
    } catch (error) {
      logger.error('Error sending span:', error);

      if (retry < this.config.maxRetries) {
        const delay = Math.min(
          this.config.initialRetryDelay * this.config.retryMultiplier ** retry,
          this.config.maxRetryDelay
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        await this.sendSpan(span, retry + 1);
      }
    }
  }

  private transformSpanToApiFormat(span: Span): Record<string, unknown> {
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

  private mapStatusForApi(status: Span['status']): string {
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

  private async ensureAgentRegistered(): Promise<void> {
    if (this.agentInstanceId) {
      return;
    }

    const url = `${this.config.apiUrl}/api/v1/agent_instance/register`;
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
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.requestTimeout),
      });

      if (response.ok) {
        const data = (await response.json()) as { details?: { id?: string } };
        this.agentInstanceId = data?.details?.id ?? null;
      } else {
        logger.error(`Failed to register agent: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Error registering agent:', error);
    }
  }

  private async startAgentInstanceHttp(): Promise<void> {
    await this.ensureAgentRegistered();

    if (!this.agentInstanceId) {
      logger.error('Cannot start agent instance: not registered');
      return;
    }

    const url = `${this.config.apiUrl}/api/v1/agent_instance/${this.agentInstanceId}/start`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(this.config.requestTimeout),
      });

      if (!response.ok) {
        logger.error(`Failed to start agent instance: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Error starting agent instance:', error);
    }
  }

  private async finishAgentInstanceHttp(): Promise<void> {
    if (!this.agentInstanceId) {
      logger.error('Cannot finish agent instance: not registered');
      return;
    }

    const url = `${this.config.apiUrl}/api/v1/agent_instance/${this.agentInstanceId}/finish`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(this.config.requestTimeout),
      });

      if (!response.ok) {
        logger.error(`Failed to finish agent instance: ${response.status} ${response.statusText}`);
      }
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

    const url = `${this.config.apiUrl}/api/v1/agent_spans/${backendSpanId}/finish`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timestamp: data.timestamp }),
        signal: AbortSignal.timeout(this.config.requestTimeout),
      });

      if (!response.ok) {
        logger.error(`Failed to finish span: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Error finishing span:', error);
    }
  }
}
