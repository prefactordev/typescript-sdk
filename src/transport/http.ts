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
   * Transform span to backend API format (snake_case)
   */
  private transformSpanToApiFormat(span: Span): Record<string, unknown> {
    return {
      agent_instance_id: this.agentInstanceId,
      parent_span_id: span.parentSpanId ? (this.spanIdMap.get(span.parentSpanId) ?? null) : null,
      name: span.name,
      span_type: span.spanType,
      start_time: new Date(span.startTime).toISOString(),
      end_time: span.endTime ? new Date(span.endTime).toISOString() : null,
      status: span.status,
      inputs: span.inputs,
      outputs: span.outputs,
      token_usage: span.tokenUsage
        ? {
            prompt_tokens: span.tokenUsage.promptTokens,
            completion_tokens: span.tokenUsage.completionTokens,
            total_tokens: span.tokenUsage.totalTokens,
          }
        : null,
      error: span.error
        ? {
            error_type: span.error.errorType,
            message: span.error.message,
            stacktrace: span.error.stacktrace,
          }
        : null,
      metadata: span.metadata,
      tags: span.tags,
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
    if (this.config.agentVersion) payload.agent_version = this.config.agentVersion;
    if (this.config.agentName) payload.agent_name = this.config.agentName;
    if (this.config.agentSchema && !this.config.skipSchema) {
      payload.agent_schema = this.config.agentSchema;
    }
    if (this.config.agentSchemaVersion) {
      payload.agent_schema_version = this.config.agentSchemaVersion;
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
        body: JSON.stringify({ end_time: data.timestamp }),
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
