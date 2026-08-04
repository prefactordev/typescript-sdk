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

export type AgentInstanceRecordQualityPayload = {
  /** Quality schema name (key in the agent schema version quality_schemas). */
  name: string;
  /** Quality payload for this name, or null to remove the recorded payload. */
  payload: Record<string, unknown> | null;
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

  /**
   * Records a named quality payload on an agent instance.
   *
   * A null payload removes the recorded value for that name. Other names
   * are left unchanged. An idempotency key is auto-generated when omitted.
   *
   * @param agentInstanceId - Backend agent instance ID.
   * @param payload - Quality schema name and payload (or null to remove).
   * @returns The API response containing the updated instance details.
   */
  recordQuality(
    agentInstanceId: string,
    payload: AgentInstanceRecordQualityPayload
  ): Promise<AgentInstanceResponse> {
    return this.httpClient.request(`/api/v1/agent_instance/${agentInstanceId}/record_quality`, {
      method: 'POST',
      body: {
        name: payload.name,
        payload: payload.payload,
        idempotency_key: ensureIdempotencyKey(payload.idempotency_key),
      },
    });
  }
}
