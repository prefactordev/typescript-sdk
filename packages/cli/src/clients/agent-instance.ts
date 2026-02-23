import type { ApiClient } from '../api-client.js';

export interface AgentInstance {
  id: string;
  agent_id: string;
  status: string;
}

export interface AgentVersionRegistration {
  external_identifier: string;
  name: string;
  description?: string;
}

export interface AgentSchemaVersionRegistration {
  external_identifier: string;
  span_schemas?: Record<string, unknown>;
  span_type_schemas?: unknown[];
  span_result_schemas?: Record<string, unknown>;
}

export interface AgentInstanceRegistrationPayload {
  agent_id: string;
  agent_version: AgentVersionRegistration;
  agent_schema_version: AgentSchemaVersionRegistration;
  id?: string;
  update_current_version?: boolean;
}

export interface AgentInstanceFinishOptions {
  timestamp?: string;
  status?: string;
}

export interface AgentInstanceResponse {
  details: AgentInstance;
}

export interface AgentInstanceListResponse {
  details: AgentInstance[];
}

export class AgentInstanceClient {
  constructor(private readonly client: ApiClient) {}

  list(agentId: string): Promise<AgentInstanceListResponse> {
    return this.client.request('/agent_instance', {
      method: 'GET',
      query: { agent_id: agentId },
    });
  }

  retrieve(id: string): Promise<AgentInstanceResponse> {
    return this.client.request(`/agent_instance/${id}`, { method: 'GET' });
  }

  register(payload: AgentInstanceRegistrationPayload): Promise<AgentInstanceResponse> {
    return this.client.request('/agent_instance/register', {
      method: 'POST',
      body: payload,
    });
  }

  start(id: string, timestamp?: string): Promise<AgentInstanceResponse> {
    return this.client.request(`/agent_instance/${id}/start`, {
      method: 'POST',
      body: timestamp ? { timestamp } : {},
    });
  }

  finish(id: string, options: AgentInstanceFinishOptions = {}): Promise<AgentInstanceResponse> {
    return this.client.request(`/agent_instance/${id}/finish`, {
      method: 'POST',
      body: options,
    });
  }
}
