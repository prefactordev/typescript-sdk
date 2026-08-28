import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface AgentVersion {
  id: string;
  agent_id: string;
  external_identifier: string;
}

export interface AgentVersionSummary {
  account_id: string;
  agent_id: string;
  agent_schema_version_id: string;
  current_agent_deployment_refs: string[];
  external_identifier: string;
  external_identifier_repeats: number;
  id: string;
  inserted_at: string;
  observed_classification?:
    | 'unknown'
    | 'public'
    | 'internal'
    | 'confidential'
    | 'restricted'
    | 'secret'
    | null;
  theoretical_classification?:
    | 'unknown'
    | 'public'
    | 'internal'
    | 'confidential'
    | 'restricted'
    | 'secret'
    | null;
  type: 'agent_version';
  updated_at: string;
}

export interface AgentVersionResponse {
  details: AgentVersion;
}

export type AgentVersionListResponse = ListResponse<AgentVersionSummary>;

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
