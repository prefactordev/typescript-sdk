import { HttpClientError, type HttpRequester } from './http-client.js';
import { ensureIdempotencyKey } from './idempotency.js';

export type AgentSpanStatus = 'active' | 'complete' | 'failed';

export type AgentSpanFinishStatus = 'complete' | 'failed' | 'cancelled';

export type AgentSpanFinishOptions = {
  status?: AgentSpanFinishStatus;
  result_payload?: Record<string, unknown>;
  idempotency_key?: string;
};

export type AgentSpanCreatePayload = {
  details: {
    agent_instance_id: string | null;
    schema_name: string;
    status: AgentSpanStatus;
    payload: Record<string, unknown>;
    result_payload?: Record<string, unknown>;
    parent_span_id: string | null;
    started_at: string;
    finished_at: string | null;
  };
  idempotency_key?: string;
};

export type AgentSpanControlSignal = {
  terminate?: boolean;
  reason?: string | null;
};

export type AgentSpanResponse = {
  details?: {
    id?: string;
    started_at?: string;
  };
  control?: AgentSpanControlSignal;
};

export class AgentSpanClient {
  constructor(private readonly httpClient: HttpRequester) {}

  create(payload: AgentSpanCreatePayload): Promise<AgentSpanResponse> {
    return this.httpClient.request('/api/v1/agent_spans', {
      method: 'POST',
      body: { ...payload, idempotency_key: ensureIdempotencyKey(payload.idempotency_key) },
    });
  }

  async finish(
    spanId: string,
    timestamp: string,
    options: AgentSpanFinishOptions = {}
  ): Promise<AgentSpanResponse> {
    try {
      return await this.httpClient.request<AgentSpanResponse>(
        `/api/v1/agent_spans/${spanId}/finish`,
        {
          method: 'POST',
          body: {
            timestamp,
            ...options,
            idempotency_key: ensureIdempotencyKey(options.idempotency_key),
          },
        }
      );
    } catch (error) {
      if (
        error instanceof HttpClientError &&
        error.status === 409 &&
        isAlreadyFinishedError(error.responseBody)
      ) {
        return {};
      }

      throw error;
    }
  }
}

function isAlreadyFinishedError(responseBody: unknown): boolean {
  if (!responseBody || typeof responseBody !== 'object') {
    return false;
  }

  const payload = responseBody as Record<string, unknown>;
  return payload.code === 'invalid_action';
}
