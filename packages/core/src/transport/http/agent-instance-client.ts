import type { AgentSchemaVersion } from '../../tracing/span-schema.js';
import type { HttpRequester } from './http-client.js';
import { ensureIdempotencyKey } from './idempotency.js';

export type AgentInstanceRegisterPayload = {
  agent_id?: string;
  environment_id?: string;
  /** Why this instance ran: 'live' for an actual agent run, 'smoke_test' for a pipeline check, or 'eval' for an evaluation run. Omit to let the API default to 'live'. */
  purpose?: 'live' | 'smoke_test' | 'eval';
  agent_version?: {
    external_identifier: string;
    name: string;
    description: string;
  };
  agent_schema_version?: AgentSchemaVersion;
  idempotency_key?: string;
};

export type AgentInstanceResponse = {
  details?: {
    id?: string;
  };
};

export type AgentInstanceStartOptions = {
  timestamp?: string;
  idempotency_key?: string;
};

export type AgentInstanceFinishOptions = {
  status?: 'complete' | 'failed' | 'cancelled';
  timestamp?: string;
  idempotency_key?: string;
};

export type AgentInstanceUpdatePayload = {
  details: {
    /** Quality evaluation payload for this instance (omit to keep current; null to clear). */
    quality_payload?: Record<string, unknown> | null;
  };
  idempotency_key?: string;
};

export class AgentInstanceClient {
  constructor(private readonly httpClient: HttpRequester) {}

  register(payload: AgentInstanceRegisterPayload): Promise<AgentInstanceResponse> {
    return this.httpClient.request('/api/v1/agent_instance/register', {
      method: 'POST',
      body: { ...payload, idempotency_key: ensureIdempotencyKey(payload.idempotency_key) },
    });
  }

  start(
    agentInstanceId: string,
    options?: AgentInstanceStartOptions
  ): Promise<AgentInstanceResponse> {
    const opts = options ?? {};
    return this.httpClient.request(`/api/v1/agent_instance/${agentInstanceId}/start`, {
      method: 'POST',
      body: { ...opts, idempotency_key: ensureIdempotencyKey(opts.idempotency_key) },
    });
  }

  finish(
    agentInstanceId: string,
    options?: AgentInstanceFinishOptions
  ): Promise<AgentInstanceResponse> {
    const opts = options ?? {};
    return this.httpClient.request(`/api/v1/agent_instance/${agentInstanceId}/finish`, {
      method: 'POST',
      body: { ...opts, idempotency_key: ensureIdempotencyKey(opts.idempotency_key) },
    });
  }

  update(
    agentInstanceId: string,
    payload: AgentInstanceUpdatePayload
  ): Promise<AgentInstanceResponse> {
    return this.httpClient.request(`/api/v1/agent_instance/${agentInstanceId}`, {
      method: 'PUT',
      body: { ...payload, idempotency_key: ensureIdempotencyKey(payload.idempotency_key) },
    });
  }
}
