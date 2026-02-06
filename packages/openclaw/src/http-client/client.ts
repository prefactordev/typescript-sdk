// HTTP Client for Prefactor API
// Handles retry logic with exponential backoff

import type {
  AgentInstanceDetails,
  AgentSpanDetails,
  CreateAgentSpanRequest,
  ErrorResponse,
  FinishAgentInstanceRequest,
  FinishAgentSpanRequest,
  RegisterAgentInstanceRequest,
  StartAgentInstanceRequest,
} from './types.js';
import {
  PrefactorConfigError,
  PrefactorError,
  PrefactorNetworkError,
  PrefactorTimeoutError,
} from './errors.js';

export interface PrefactorConfig {
  apiUrl: string;
  apiToken: string;
  agentId: string;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

interface RetryOptions {
  maxRetries: number;
  retryDelay: number;
  timeout: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof PrefactorNetworkError) {
    return true;
  }
  if (error instanceof PrefactorError && error.statusCode !== undefined) {
    // Retry on 5xx errors, not on 4xx
    return error.statusCode >= 500;
  }
  return false;
}

export class PrefactorClient {
  private readonly apiUrl: string;
  private readonly apiToken: string;
  readonly agentId: string;
  private readonly retryOptions: RetryOptions;

  constructor(config: PrefactorConfig) {
    // Validate required config - no defaults
    if (!config.apiUrl) {
      throw new PrefactorConfigError('apiUrl is required');
    }
    if (!config.apiToken) {
      throw new PrefactorConfigError('apiToken is required');
    }
    if (!config.agentId) {
      throw new PrefactorConfigError('agentId is required');
    }

    this.apiUrl = config.apiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiToken = config.apiToken;
    this.agentId = config.agentId;
    this.retryOptions = {
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      timeout: config.timeout ?? 30000,
    };
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.retryOptions.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PrefactorTimeoutError();
      }
      throw new PrefactorNetworkError(
        error instanceof Error ? error.message : 'Network request failed',
        error instanceof Error ? error : undefined,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async makeRequest<T>(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiToken}`,
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, options);

        // Handle HTTP errors
        if (!response.ok) {
          let errorData: ErrorResponse | undefined;
          try {
            errorData = (await response.json()) as ErrorResponse;
          } catch {
            // If JSON parsing fails, use status text
          }

          // Log the full error response for debugging
          console.error(`[PrefactorClient] HTTP ${response.status} error:`, JSON.stringify(errorData));
          
          throw new PrefactorError(
            errorData?.message || response.statusText,
            errorData?.code,
            response.status,
            errorData,
          );
        }

        const data = (await response.json()) as T;
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on the last attempt
        if (attempt === this.retryOptions.maxRetries) {
          break;
        }

        // Don't retry if error is not retryable
        if (!isRetryableError(error)) {
          throw error;
        }

        // Exponential backoff
        const delay = this.retryOptions.retryDelay * Math.pow(2, attempt);
        await sleep(delay);
      }
    }

    // If we get here, all retries failed
    throw lastError;
  }

  // AgentInstance endpoints

  async registerAgentInstance(
    body: RegisterAgentInstanceRequest,
  ): Promise<AgentInstanceDetails> {
    const response = await this.makeRequest<
      { status: 'success'; details: AgentInstanceDetails }
    >('POST', '/api/v1/agent_instance/register', body);
    return response.details;
  }

  async startAgentInstance(
    instanceId: string,
    body: StartAgentInstanceRequest,
  ): Promise<AgentInstanceDetails> {
    const response = await this.makeRequest<
      { status: 'success'; details: AgentInstanceDetails }
    >('POST', `/api/v1/agent_instance/${instanceId}/start`, body);
    return response.details;
  }

  async finishAgentInstance(
    instanceId: string,
    body: FinishAgentInstanceRequest,
  ): Promise<AgentInstanceDetails> {
    const response = await this.makeRequest<
      { status: 'success'; details: AgentInstanceDetails }
    >('POST', `/api/v1/agent_instance/${instanceId}/finish`, body);
    return response.details;
  }

  // AgentSpan endpoints

  async createAgentSpan(body: CreateAgentSpanRequest): Promise<AgentSpanDetails> {
    const response = await this.makeRequest<
      { status: 'success'; details: AgentSpanDetails }
    >('POST', '/api/v1/agent_spans', body);
    return response.details;
  }

  async finishAgentSpan(
    spanId: string,
    body: FinishAgentSpanRequest,
  ): Promise<AgentSpanDetails> {
    const response = await this.makeRequest<
      { status: 'success'; details: AgentSpanDetails }
    >('POST', `/api/v1/agent_spans/${spanId}/finish`, body);
    return response.details;
  }
}

// Factory function to create client from environment variables
export function createClientFromEnv(overrides?: Partial<PrefactorConfig>): PrefactorClient {
  const apiUrl = process.env.PREFACTOR_API_URL;
  const apiToken = process.env.PREFACTOR_API_TOKEN;
  const agentId = process.env.PREFACTOR_AGENT_ID;

  if (!apiUrl && !overrides?.apiUrl) {
    throw new PrefactorConfigError('PREFACTOR_API_URL environment variable is required');
  }
  if (!apiToken && !overrides?.apiToken) {
    throw new PrefactorConfigError('PREFACTOR_API_TOKEN environment variable is required');
  }
  if (!agentId && !overrides?.agentId) {
    throw new PrefactorConfigError('PREFACTOR_AGENT_ID environment variable is required');
  }

  return new PrefactorClient({
    apiUrl: overrides?.apiUrl || apiUrl!,
    apiToken: overrides?.apiToken || apiToken!,
    agentId: overrides?.agentId || agentId!,
    maxRetries: overrides?.maxRetries,
    retryDelay: overrides?.retryDelay,
    timeout: overrides?.timeout,
  });
}
