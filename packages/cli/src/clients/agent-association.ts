import type { ApiClient } from '../api-client.js';
import { type ListQueryParams, type ListResponse, listQuery } from './list-response.js';

export type AgentAssociationTrigger = 'on_demand' | 'on_completion';

export interface AgentAssociationSummary {
  id: string;
  type: 'agent_association';
  account_id: string;
  from_agent_id: string;
  to_agent_id: string;
  association_type: string;
  trigger: AgentAssociationTrigger;
  inserted_at: string;
  updated_at: string;
}

export type AgentAssociationDetails = AgentAssociationSummary;

export interface AgentAssociationForCreate {
  from_agent_id: string;
  to_agent_id: string;
  association_type: string;
  trigger: AgentAssociationTrigger;
  id?: string;
}

export interface AgentAssociationListParams extends ListQueryParams {
  agent_id: string;
}

export interface AgentAssociationResponse {
  details: AgentAssociationDetails;
  status: 'success';
}

export type AgentAssociationListResponse = ListResponse<AgentAssociationSummary>;

export class AgentAssociationClient {
  constructor(private readonly client: ApiClient) {}

  listFrom(params: AgentAssociationListParams): Promise<AgentAssociationListResponse> {
    return this.client.request('/agent_association/from', {
      method: 'GET',
      query: { agent_id: params.agent_id, ...listQuery(params) },
    });
  }

  listTo(params: AgentAssociationListParams): Promise<AgentAssociationListResponse> {
    return this.client.request('/agent_association/to', {
      method: 'GET',
      query: { agent_id: params.agent_id, ...listQuery(params) },
    });
  }

  retrieve(id: string): Promise<AgentAssociationResponse> {
    return this.client.request(`/agent_association/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  create(details: AgentAssociationForCreate): Promise<AgentAssociationResponse> {
    return this.client.request('/agent_association', {
      method: 'POST',
      body: { details },
    });
  }

  update(id: string, trigger: AgentAssociationTrigger): Promise<AgentAssociationResponse> {
    return this.client.request(`/agent_association/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { details: { trigger } },
    });
  }

  delete(id: string): Promise<AgentAssociationResponse> {
    return this.client.request(`/agent_association/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
