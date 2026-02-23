import type { ApiClient } from '../api-client.js';

export interface AgentVersion {
  id: string;
  agent_id: string;
  external_identifier: string;
}

export interface AgentVersionResponse {
  details: AgentVersion;
}

export interface AgentVersionListResponse {
  details: AgentVersion[];
}

export class AgentVersionClient {
  constructor(private readonly client: ApiClient) {}

  list(agentId: string): Promise<AgentVersionListResponse> {
    return this.client.request('/agent_version', {
      method: 'GET',
      query: { agent_id: agentId },
    });
  }

  retrieve(id: string): Promise<AgentVersionResponse> {
    return this.client.request(`/agent_version/${id}`, { method: 'GET' });
  }

  create(agentId: string, externalIdentifier: string): Promise<AgentVersionResponse> {
    return this.client.request('/agent_version', {
      method: 'POST',
      body: {
        details: {
          agent_id: agentId,
          external_identifier: externalIdentifier,
        },
      },
    });
  }
}
