import type { ApiClient } from '../api-client.js';
import { type ListQueryParams, type ListResponse, listQuery } from './list-response.js';

export interface AgentInstanceAssociationSummary {
  id: string;
  type: 'agent_instance_association';
  account_id: string;
  from_agent_instance_id: string;
  to_agent_instance_id: string;
  association_type: string;
  agent_association_id: string;
  inserted_at: string;
  updated_at: string;
}

export type AgentInstanceAssociationDetails = AgentInstanceAssociationSummary;

export interface AgentInstanceAssociationListFromParams extends ListQueryParams {
  agent_instance_ids: string[];
}

export interface AgentInstanceAssociationListToParams extends ListQueryParams {
  agent_instance_id: string;
}

export interface AgentInstanceAssociationResponse {
  details: AgentInstanceAssociationDetails;
  status: 'success';
}

export type AgentInstanceAssociationListResponse = ListResponse<AgentInstanceAssociationSummary>;

export class AgentInstanceAssociationClient {
  constructor(private readonly client: ApiClient) {}

  listFrom(
    params: AgentInstanceAssociationListFromParams
  ): Promise<AgentInstanceAssociationListResponse> {
    return this.client.request('/agent_instance_association/from', {
      method: 'GET',
      query: {
        agent_instance_ids: params.agent_instance_ids,
        ...listQuery(params),
      },
    });
  }

  listTo(
    params: AgentInstanceAssociationListToParams
  ): Promise<AgentInstanceAssociationListResponse> {
    return this.client.request('/agent_instance_association/to', {
      method: 'GET',
      query: { agent_instance_id: params.agent_instance_id, ...listQuery(params) },
    });
  }

  retrieve(id: string): Promise<AgentInstanceAssociationResponse> {
    return this.client.request(`/agent_instance_association/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }
}
