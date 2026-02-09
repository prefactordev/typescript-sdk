import type { HttpRequester } from './http-client.js';

export type AgentInstanceRegisterPayload = {
  agent_id?: string;
  agent_version?: {
    external_identifier: string;
    name: string;
    description: string;
  };
  agent_schema_version?: Record<string, unknown>;
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

export class AgentInstanceClient {
  constructor(private readonly httpClient: HttpRequester) {}

  register(payload: AgentInstanceRegisterPayload): Promise<AgentInstanceResponse> {
    return this.httpClient.request('/api/v1/agent_instance/register', {
      method: 'POST',
      body: payload,
    });
  }

  start(agentInstanceId: string, options?: AgentInstanceStartOptions): Promise<AgentInstanceResponse> {
    return this.httpClient.request(`/api/v1/agent_instance/${agentInstanceId}/start`, {
      method: 'POST',
      body: options ?? {},
    });
  }

  finish(agentInstanceId: string, options?: AgentInstanceFinishOptions): Promise<AgentInstanceResponse> {
    return this.httpClient.request(`/api/v1/agent_instance/${agentInstanceId}/finish`, {
      method: 'POST',
      body: options ?? {},
    });
  }
}
