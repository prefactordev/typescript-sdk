import type { HttpTransportConfig } from '../config.js';
import type { QueueAction } from '../queue/actions.js';
import { DEFAULT_AGENT_SCHEMA, type Span } from '../tracing/span.js';
import { getLogger } from '../utils/logging.js';
import type { Transport } from './base.js';

const logger = getLogger('http-transport');

/**
 * HTTP transport sends spans to a remote API endpoint.
 *
 * Features:
 * - Exponential backoff retry logic
 * - Span ID mapping (SDK ID → backend ID)
 * - Agent instance lifecycle management
 *
 * @example
 * ```typescript
 * const transport = new HttpTransport({
 *   apiUrl: 'https://api.prefactor.ai',
 *   apiToken: process.env.PREFACTOR_API_TOKEN!,
 * });
 * ```
 */
export class HttpTransport implements Transport {
  private closed = false;
  private agentInstanceId: string | null = null;
  private spanIdMap = new Map<string, string>();
  // Pending finishes for spans that arrived before their span_end
  private pendingFinishes = new Map<string, number>();

  constructor(private config: HttpTransportConfig) {}

  async processBatch(items: QueueAction[]): Promise<void> {
    if (this.closed || items.length === 0) {
      return;
    }

    // First pass: apply schema updates
    for (const item of items) {
      if (item.type === 'schema_register') {
        this.config.agentSchema = item.data.schema;
      }
    }

    // Second pass: process actions
    for (const item of items) {
      try {
        switch (item.type) {
          case 'schema_register':
            break;
          case 'agent_start':
            if (item.data.agentId !== undefined) this.config.agentId = item.data.agentId;
            if (item.data.agentIdentifier !== undefined)
              this.config.agentIdentifier = item.data.agentIdentifier;
            if (item.data.agentName !== undefined) this.config.agentName = item.data.agentName;
            if (item.data.agentDescription !== undefined)
              this.config.agentDescription = item.data.agentDescription;
            await this.startAgentInstanceHttp();
            break;
          case 'agent_finish':
            await this.finishAgentInstanceHttp();
            break;
          case 'span_end':
            if (!this.agentInstanceId) {
              await this.ensureAgentRegistered();
            }
            await this.sendSpan(item.data);
            break;
          case 'span_finish': {
            const spanId = item.data.spanId;
            const backendSpanId = this.spanIdMap.get(spanId);
            if (backendSpanId) {
              // Span mapping exists, finish immediately
              const timestamp = new Date(item.data.endTime).toISOString();
              await this.finishSpanHttp({ spanId, timestamp });
            } else {
              // Defer finish until span_end creates the mapping
              this.pendingFinishes.set(spanId, item.data.endTime);
            }
            break;
          }
        }
      } catch (error) {
        logger.error('Error processing batch item:', error);
      }
    }
  }

  /**
   * Process any pending finishes for a span that was just registered.
   */
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

  /**
   * Send a span to the API
   */
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
          // Process any pending finishes that arrived before this span_end
          await this.processPendingFinishes(span.spanId);
        }
        return;
      }

      // Retry on server errors or rate limiting
      if ((response.status >= 500 || response.status === 429) && retry < this.config.maxRetries) {
        const delay = Math.min(
          this.config.initialRetryDelay * this.config.retryMultiplier ** retry,
          this.config.maxRetryDelay
        );
        logger.debug(`Retrying span send after ${delay}ms (attempt ${retry + 1})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendSpan(span, retry + 1);
      }

      logger.error(`Failed to send span: ${response.status} ${response.statusText}`);
      logger.error(`Failed span: ${await response.text()}`);
    } catch (error) {
      logger.error('Error sending span:', error);

      // Retry on network errors
      if (retry < this.config.maxRetries) {
        const delay = Math.min(
          this.config.initialRetryDelay * this.config.retryMultiplier ** retry,
          this.config.maxRetryDelay
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendSpan(span, retry + 1);
      }
    }
  }

  /**
   * Transform span to backend API format with nested details/payload structure
   */
  private transformSpanToApiFormat(span: Span): Record<string, unknown> {
    const startedAt = new Date(span.startTime).toISOString();
    const finishedAt = span.endTime ? new Date(span.endTime).toISOString() : null;
    const apiStatus = this.mapStatusForApi(span.status);

    // Build payload with span data
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

    // Add optional token_usage
    if (span.tokenUsage) {
      payload.token_usage = {
        prompt_tokens: span.tokenUsage.promptTokens,
        completion_tokens: span.tokenUsage.completionTokens,
        total_tokens: span.tokenUsage.totalTokens,
      };
    }

    // Add optional error
    if (span.error) {
      payload.error = {
        error_type: span.error.errorType,
        message: span.error.message,
        stacktrace: span.error.stacktrace,
      };
    }

    // Resolve parent span ID to backend ID
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

  /**
   * Get default schema (v1.0.0) with span schemas for all supported types
   */
  private getDefaultSchema(): Record<string, unknown> {
    return DEFAULT_AGENT_SCHEMA;
  }

  /**
   * Ensure an agent instance is registered
   */
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

    // Schema handling:
    // 1. agentSchema provided: Use full custom schema object
    // 2. No schema: Use default hardcoded schema
    if (this.config.agentSchema) {
      logger.debug('Using custom agent schema');
      payload.agent_schema_version = this.config.agentSchema;
    } else {
      logger.debug('Using default hardcoded schema (v1.0.0)');
      payload.agent_schema_version = this.getDefaultSchema();
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
        logger.debug(`Registered agent instance: ${this.agentInstanceId}`);
      } else {
        logger.error(`Failed to register agent: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Error registering agent:', error);
    }
  }

  /**
   * Start agent instance execution
   */
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

  /**
   * Finish agent instance execution
   */
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

    // Reset so the next agent_start registers a fresh instance
    this.agentInstanceId = null;
  }

  /**
   * Finish a span via HTTP
   */
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

  /**
   * Close the transport and wait for queue to drain
   *
   * @returns Promise that resolves when transport is closed
   */
  async close(): Promise<void> {
    this.closed = true;

    // Log warning for any pending finishes that will never be processed
    if (this.pendingFinishes.size > 0) {
      logger.warn(
        `Transport closed with ${this.pendingFinishes.size} pending span finish(es) that could not be processed`
      );
      this.pendingFinishes.clear();
    }
  }
}
