import type { Transport } from './base.js';
import type { HttpTransportConfig } from '../config.js';
import type { Span } from '../tracing/span.js';
import { getLogger } from '../utils/logging.js';

const logger = getLogger('http-transport');

/**
 * Queue item types for background processing
 */
interface QueueItem {
  type: 'span' | 'finish_span' | 'start_agent' | 'finish_agent';
  data: unknown;
}

/**
 * HTTP transport sends spans to a remote API endpoint.
 *
 * Features:
 * - Queue-based async processing
 * - Exponential backoff retry logic
 * - Span ID mapping (SDK ID → backend ID)
 * - Agent instance lifecycle management
 * - Graceful shutdown with timeout
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
  private queue: QueueItem[] = [];
  private processing = false;
  private closed = false;
  private agentInstanceId: string | null = null;
  private spanIdMap = new Map<string, string>();

  constructor(private config: HttpTransportConfig) {
    this.startProcessing();
  }

  /**
   * Emit a span (adds to queue for async processing)
   *
   * @param span - The span to emit
   */
  emit(span: Span): void {
    if (this.closed) {
      return;
    }
    this.queue.push({ type: 'span', data: span });
  }

  /**
   * Finish a previously emitted span (for AGENT spans)
   *
   * @param spanId - ID of the span to finish
   * @param endTime - End time in milliseconds since Unix epoch
   */
  finishSpan(spanId: string, endTime: number): void {
    if (this.closed) {
      return;
    }
    const timestamp = new Date(endTime).toISOString();
    this.queue.push({ type: 'finish_span', data: { spanId, timestamp } });
  }

  /**
   * Signal the start of an agent instance execution
   */
  startAgentInstance(): void {
    if (this.closed) {
      return;
    }
    this.queue.push({ type: 'start_agent', data: null });
  }

  /**
   * Signal the completion of an agent instance execution
   */
  finishAgentInstance(): void {
    if (this.closed) {
      return;
    }
    this.queue.push({ type: 'finish_agent', data: null });
  }

  /**
   * Start background queue processing
   */
  private async startProcessing(): Promise<void> {
    this.processing = true;

    while (!this.closed || this.queue.length > 0) {
      if (this.queue.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      const item = this.queue.shift()!;

      try {
        // Ensure agent is registered before processing spans
        if (!this.agentInstanceId && item.type !== 'start_agent') {
          await this.ensureAgentRegistered();
        }

        switch (item.type) {
          case 'span':
            await this.sendSpan(item.data as Span);
            break;
          case 'finish_span':
            await this.finishSpanHttp(item.data as { spanId: string; timestamp: string });
            break;
          case 'start_agent':
            await this.startAgentInstanceHttp();
            break;
          case 'finish_agent':
            await this.finishAgentInstanceHttp();
            break;
        }
      } catch (error) {
        logger.error('Error processing queue item:', error);
      }
    }

    this.processing = false;
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
        const data = await response.json() as { details?: { id?: string } };
        const backendSpanId = data?.details?.id;
        if (backendSpanId) {
          this.spanIdMap.set(span.spanId, backendSpanId);
        }
        return;
      }

      // Retry on server errors or rate limiting
      if ((response.status >= 500 || response.status === 429) && retry < this.config.maxRetries) {
        const delay = Math.min(
          this.config.initialRetryDelay * Math.pow(this.config.retryMultiplier, retry),
          this.config.maxRetryDelay
        );
        logger.debug(`Retrying span send after ${delay}ms (attempt ${retry + 1})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendSpan(span, retry + 1);
      }

      logger.error(`Failed to send span: ${response.status} ${response.statusText}`);
    } catch (error) {
      logger.error('Error sending span:', error);

      // Retry on network errors
      if (retry < this.config.maxRetries) {
        const delay = Math.min(
          this.config.initialRetryDelay * Math.pow(this.config.retryMultiplier, retry),
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

    // Build payload with span data
    const payload: Record<string, unknown> = {
      span_id: span.spanId,
      trace_id: span.traceId,
      name: span.name,
      status: span.status,
      inputs: span.inputs,
      outputs: span.outputs,
      metadata: span.metadata,
      tags: span.tags,
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
    const parentSpanId = span.parentSpanId
      ? (this.spanIdMap.get(span.parentSpanId) ?? null)
      : null;

    return {
      details: {
        agent_instance_id: this.agentInstanceId,
        schema_name: span.spanType,
        payload,
        parent_span_id: parentSpanId,
        started_at: startedAt,
        finished_at: finishedAt,
      },
    };
  }

  /**
   * Get default schema (v1.0.0) with span schemas for all supported types
   */
  private getDefaultSchema(): Record<string, unknown> {
    return {
      external_identifier: '1.0.0',
      span_schemas: {
        agent: {
          type: 'object',
          properties: { type: { type: 'string', const: 'agent' } },
        },
        llm: {
          type: 'object',
          properties: { type: { type: 'string', const: 'llm' } },
        },
        tool: {
          type: 'object',
          properties: { type: { type: 'string', const: 'tool' } },
        },
        chain: {
          type: 'object',
          properties: { type: { type: 'string', const: 'chain' } },
        },
        retriever: {
          type: 'object',
          properties: { type: { type: 'string', const: 'retriever' } },
        },
      },
    };
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
    if (this.config.agentVersion) {
      payload.agent_version = {
        external_identifier: this.config.agentVersion,
        name: this.config.agentName || 'Agent',
        description: this.config.agentDescription || '',
      };
    }

    // Schema handling - four modes:
    // 1. skipSchema=true: No schema in payload (pre-registered on backend)
    // 2. agentSchema provided: Use full custom schema object
    // 3. agentSchemaVersion provided: Use version identifier only
    // 4. None of above: Use default v1.0.0 schema
    if (this.config.skipSchema) {
      logger.debug('Skipping schema in registration (skipSchema=true)');
      // Do not add agent_schema_version key
    } else if (this.config.agentSchema) {
      logger.debug('Using custom agent schema');
      payload.agent_schema_version = this.config.agentSchema;
    } else if (this.config.agentSchemaVersion) {
      logger.debug(`Using schema version: ${this.config.agentSchemaVersion}`);
      payload.agent_schema_version = {
        external_identifier: this.config.agentSchemaVersion,
      };
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
        const data = await response.json() as { details?: { id?: string } };
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

    // Wait for queue to drain (with timeout)
    const timeout = 10000;
    const start = Date.now();
    while (this.processing && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.processing) {
      logger.warn('Transport closed with pending queue items');
    }
  }
}
