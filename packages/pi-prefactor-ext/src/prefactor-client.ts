/**
 * Prefactor API Client
 *
 * HTTP client for Prefactor API operations.
 * Handles instance lifecycle and span CRUD operations.
 *
 * @module
 */

import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { SpanSchemaName, AnySpanPayload, AnySpanResult } from './schemas.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

/**
 * X-Prefactor-SDK header value.
 *
 * Follows the convention from @prefactor/core: each SDK component
 * includes its own entry (`name@version`), and the core appends its own.
 * Since this extension makes direct HTTP calls (no core HttpClient),
 * we include both entries manually.
 */
const SDK_HEADER = `${PACKAGE_NAME}@${PACKAGE_VERSION} @prefactor/core@0.3.3`;

/**
 * Prefactor API client configuration
 */
export interface PrefactorClientConfig {
  apiUrl: string;
  apiToken: string;
  agentId: string;
  requestTimeout?: number;
  maxRetries?: number;
}

/**
 * API response types
 */
interface ApiResponse<T> {
  details?: T;
  error?: string;
}

interface AgentInstanceResponse {
  id?: string;
}

interface AgentSpanResponse {
  id?: string;
}

/**
 * Request types for API calls
 */
interface RegisterInstanceRequest {
  agent_id: string;
  agent_version: {
    external_identifier: string;
    name: string;
    description: string;
  };
  agent_schema_version: {
    external_identifier: string;
    span_type_schemas: Array<{
      name: string;
      description?: string | null;
      template?: string | null;
      result_template?: string | null;
      params_schema: {
        type: string;
        properties: Record<string, { type: string; description?: string }>;
        required?: string[];
      };
      result_schema?: {
        type: string;
        properties: Record<string, { type: string; description?: string }>;
      };
    }>;
  };
  idempotency_key: string;
}

interface StartInstanceRequest {
  timestamp: string;
  idempotency_key: string;
}

interface FinishInstanceRequest {
  status: string;
  timestamp: string;
  idempotency_key: string;
}

interface CreateSpanRequest {
  details: {
    agent_instance_id: string;
    schema_name: string;
    status: string;
    payload: Record<string, unknown>;
    parent_span_id: string | null;
    started_at: string;
    finished_at: string | null;
  };
  idempotency_key: string;
}

interface FinishSpanRequest {
  status: string;
  timestamp: string;
  idempotency_key: string;
  result_payload?: Record<string, unknown>;
}

/**
 * Prefactor API Client
 *
 * Manages AgentInstance lifecycle and span CRUD via Prefactor API.
 * All methods handle errors gracefully - log and continue, never throw.
 */
export class PrefactorClient {
  private config: PrefactorClientConfig;
  private logger: Logger;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: Config, logger: Logger) {
    this.config = {
      apiUrl: config.apiUrl,
      apiToken: config.apiToken!,
      agentId: config.agentId!,
      requestTimeout: 30000,
      maxRetries: 3,
    };
    this.logger = logger;
    this.baseUrl = config.apiUrl.replace(/\/$/, ''); // Remove trailing slash

    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiToken!}`,
      'X-Agent-ID': config.agentId!,
      'X-Prefactor-SDK': SDK_HEADER,
    };

    logger.debug('prefactor_client_init', {
      apiUrl: this.baseUrl,
      agentId: config.agentId,
      sdkHeader: SDK_HEADER,
    });
  }

  /**
   * Make HTTP request with error handling
   */
  private async request<T>(
    path: string,
    method: string,
    body?: unknown
  ): Promise<ApiResponse<T> | null> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    try {
      this.logger.debug('api_request', { method, path });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout);

      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        // 409 Conflict (span already finished, instance already completed, etc.)
        // is expected in race conditions — log at debug level instead of error.
        const logLevel = response.status === 409 ? 'debug' : 'error';
        this.logger[logLevel]('api_request_failed', {
          method,
          path,
          status: response.status,
          error: errorText,
        });
        return { error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = (await response.json()) as ApiResponse<T>;
      this.logger.debug('api_request_success', { method, path });
      return data;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('api_request_error', { method, path, error });
      return { error };
    }
  }

  /**
   * Register a new agent instance
   */
  async createInstance(metadata?: Record<string, unknown>): Promise<{ instanceId: string } | null> {
    const idempotencyKey = crypto.randomUUID();

    const request: RegisterInstanceRequest = {
      agent_id: this.config.agentId,
      agent_version: {
        external_identifier: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
        name: 'Pi Prefactor Extension',
        description: 'Prefactor instrumentation for pi coding agent',
      },
      agent_schema_version: {
        external_identifier: 'schema-v1',
        span_type_schemas: [
          {
            name: 'pi:session',
            description: 'Pi session lifecycle',
            template: null,
            result_template: null,
            params_schema: {
              type: 'object',
              properties: {
                createdAt: { type: 'string', description: 'Session created timestamp' },
              },
            },
          },
          {
            name: 'pi:user_message',
            description: 'Inbound user message',
            template: '{{ text | default: "(no message)" }}',
            result_template: null,
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
            template: '{{ model | default: "unknown" }}',
            result_template: null,
            params_schema: {
              type: 'object',
              properties: {
                model: { type: 'string', description: 'LLM model used' },
                userRequest: { type: 'string', description: 'Original user request' },
              },
              required: ['model', 'userRequest'],
            },
            result_schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', description: 'Whether session succeeded' },
                durationMs: { type: 'number', description: 'Duration in milliseconds' },
              },
            },
          },
          {
            name: 'pi:tool_call',
            description: 'Tool execution',
            template: '{{ toolName | default: "(unknown tool)" }}',
            result_template: null,
            params_schema: {
              type: 'object',
              properties: {
                toolName: { type: 'string', description: 'Tool name' },
                toolCallId: { type: 'string', description: 'Tool call ID' },
              },
            },
          },
          {
            name: 'pi:tool:bash',
            description: 'Bash command execution',
            template: '{{ command | truncate: 100 }}',
            result_template: null,
            params_schema: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'Bash command' },
              },
            },
            result_schema: {
              type: 'object',
              properties: {
                exitCode: { type: 'number', description: 'Exit code' },
                durationMs: { type: 'number', description: 'Duration' },
              },
            },
          },
          {
            name: 'pi:tool:read',
            description: 'File read operation',
            template: '{{ path | truncate: 100 }}',
            result_template: null,
            params_schema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path' },
              },
            },
          },
          {
            name: 'pi:tool:write',
            description: 'File write operation',
            template: '{{ path | truncate: 100 }}',
            result_template: null,
            params_schema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path' },
                operation: { type: 'string', description: 'Create or update' },
              },
            },
          },
          {
            name: 'pi:tool:edit',
            description: 'File edit operation',
            template: '{{ path | truncate: 100 }}',
            result_template: null,
            params_schema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path' },
                editCount: { type: 'number', description: 'Number of edits' },
              },
            },
          },
          {
            name: 'pi:assistant_response',
            description: 'Assistant response message to user',
            template: '{{ model | default: "unknown" }}',
            result_template: '{{ text | truncate: 100 }}',
            params_schema: {
              type: 'object',
              properties: {
                model: { type: 'string', description: 'LLM model used' },
                startTime: { type: 'string', description: 'ISO timestamp when response started' },
              },
            },
          },
          {
            name: 'pi:assistant_thinking',
            description: 'Assistant thinking/reasoning',
            template: '{{ thinking | truncate: 100 }}',
            result_template: '{{ thinking | truncate: 100 }}',
            params_schema: {
              type: 'object',
              properties: {
                model: { type: 'string', description: 'LLM model used' },
                startTime: { type: 'string', description: 'ISO timestamp when thinking started' },
              },
            },
          },
        ],
      },
      idempotency_key: idempotencyKey,
    };

    const response = await this.request<AgentInstanceResponse>('/api/v1/agent_instance/register', 'POST', request);

    if (!response || response.error || !response.details?.id) {
      this.logger.error('create_instance_failed', { error: response?.error });
      return null;
    }

    const instanceId = response.details.id;
    this.logger.debug('instance_created_api', { instanceId });

    // Start the instance immediately
    await this.startInstance(instanceId);

    return { instanceId };
  }

  /**
   * Start an agent instance
   */
  async startInstance(instanceId: string): Promise<boolean> {
    const idempotencyKey = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const request: StartInstanceRequest = {
      timestamp,
      idempotency_key: idempotencyKey,
    };

    const response = await this.request<AgentInstanceResponse>(
      `/api/v1/agent_instance/${instanceId}/start`,
      'POST',
      request
    );

    if (!response || response.error) {
      this.logger.error('start_instance_failed', { instanceId, error: response?.error });
      return false;
    }

    this.logger.debug('instance_started_api', { instanceId });
    return true;
  }

  /**
   * Finish an agent instance
   */
  async finishInstance(
    instanceId: string,
    status: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    const idempotencyKey = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const request: FinishInstanceRequest = {
      status,
      timestamp,
      idempotency_key: idempotencyKey,
    };

    const response = await this.request<AgentInstanceResponse>(
      `/api/v1/agent_instance/${instanceId}/finish`,
      'POST',
      request
    );

    if (!response || response.error) {
      this.logger.error('finish_instance_failed', { instanceId, error: response?.error });
      return false;
    }

    this.logger.debug('instance_finished_api', { instanceId, status });
    return true;
  }

  /**
   * Create a new span
   */
  async createSpan(
    instanceId: string,
    schemaName: SpanSchemaName,
    payload: AnySpanPayload,
    parentSpanId?: string | null
  ): Promise<{ spanId: string } | null> {
    const idempotencyKey = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const request: CreateSpanRequest = {
      details: {
        agent_instance_id: instanceId,
        schema_name: schemaName,
        status: 'active',
        payload: payload as unknown as Record<string, unknown>,
        parent_span_id: parentSpanId ?? null,
        started_at: timestamp,
        finished_at: null,
      },
      idempotency_key: idempotencyKey,
    };

    const response = await this.request<AgentSpanResponse>('/api/v1/agent_spans', 'POST', request);

    if (!response || response.error || !response.details?.id) {
      this.logger.error('create_span_failed', { schemaName, error: response?.error });
      return null;
    }

    const spanId = response.details.id;
    this.logger.debug('span_created', { spanId, schemaName, parentSpanId });

    return { spanId };
  }

  /**
   * Finish a span with result payload
   */
  async finishSpan(
    spanId: string,
    resultPayload: AnySpanResult,
    durationMs?: number
  ): Promise<boolean> {
    const idempotencyKey = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const resultWithMeta: Record<string, unknown> = {
      ...(resultPayload as Record<string, unknown>),
    };

    if (durationMs !== undefined) {
      resultWithMeta.durationMs = durationMs;
    }

    const request: FinishSpanRequest = {
      status: 'complete',
      timestamp,
      idempotency_key: idempotencyKey,
      result_payload: resultWithMeta,
    };

    const response = await this.request<AgentSpanResponse>(
      `/api/v1/agent_spans/${spanId}/finish`,
      'POST',
      request
    );

    if (!response || response.error) {
      // 409 (already finished) is expected in races between finishAllSpans and event handlers
      // Extract the code from the error string (format: "HTTP 409: {\"code\":\"invalid_action\",...}")
      const errorStr = typeof response?.error === 'string' ? (response.error as string) : String(response?.error ?? '');
      const isAlreadyFinished = errorStr.includes('"invalid_action"') || errorStr.includes('already finished') || errorStr.includes('must be active to finish');
      if (isAlreadyFinished) {
        this.logger.debug('finish_span_already_finished', { spanId, error: errorStr.slice(0, 80) });
      } else {
        this.logger.error('finish_span_failed', { spanId, error: response?.error });
      }
      return false;
    }

    this.logger.debug('span_finished', { spanId });
    return true;
  }
}

/**
 * Create a Prefactor API client
 */
export function createPrefactorClient(config: Config, logger: Logger): PrefactorClient {
  return new PrefactorClient(config, logger);
}
