import type { ApiClient } from '../api-client.js';

export interface AgentSchemaVersion {
  id: string;
  agent_id: string;
  external_identifier: string;
}

export interface AgentSchemaVersionCreateOptions {
  span_schemas?: Record<string, unknown>;
  span_type_schemas?: unknown[];
  span_result_schemas?: Record<string, unknown>;
}

export interface AgentSchemaVersionResponse {
  details: AgentSchemaVersion;
}

export interface AgentSchemaVersionListResponse {
  details: AgentSchemaVersion[];
}

export class AgentSchemaVersionClient {
  constructor(private readonly client: ApiClient) {}

  list(agentId: string): Promise<AgentSchemaVersionListResponse> {
    return this.client.request('/agent_schema_version', {
      method: 'GET',
      query: { agent_id: agentId },
    });
  }

  retrieve(id: string): Promise<AgentSchemaVersionResponse> {
    return this.client.request(`/agent_schema_version/${id}`, { method: 'GET' });
  }

  create(
    agentId: string,
    externalIdentifier: string,
    options: AgentSchemaVersionCreateOptions = {}
  ): Promise<AgentSchemaVersionResponse> {
    return this.client.request('/agent_schema_version', {
      method: 'POST',
      body: {
        details: {
          agent_id: agentId,
          external_identifier: externalIdentifier,
          ...options,
        },
      },
    });
  }
}
