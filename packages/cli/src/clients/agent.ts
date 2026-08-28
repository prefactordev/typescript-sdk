import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface Agent {
  id: string;
  name: string;
  description?: string;
  status: string;
}

export interface AgentAvailableActions {
  delete?: boolean;
  reinstate?: boolean;
  retire?: boolean;
  update?: boolean;
}

export interface AgentInstanceCounts {
  active?: number;
  cancelled?: number;
  complete?: number;
  failed?: number;
  finished?: number;
  pending?: number;
  terminated?: number;
  total?: number;
}

export interface AgentSummary {
  available_actions?: AgentAvailableActions;
  description?: string | null;
  external_identifier?: string | null;
  id?: string;
  inserted_at?: string;
  instance_counts?: AgentInstanceCounts;
  last_activity_span_at?: string | null;
  name?: string;
  owner_person_id?: string | null;
  status?: 'pending' | 'active' | 'dormant' | 'retired';
  team_id?: string | null;
  type?: 'agent';
  updated_at?: string;
}

export interface AgentDetails {
  id?: string;
  name?: string;
  description?: string;
}

export interface AgentResponse {
  details: Agent;
}

export type AgentListResponse = ListResponse<AgentSummary>;

export type AgentClassification =
  | 'unknown'
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted'
  | 'secret';

export interface AgentRiskSummary {
  all_data_categories?: string[];
  assessed_span_types?: number;
  classification_counts?: {
    confidential?: number;
    internal?: number;
    public?: number;
    restricted?: number;
    secret?: number;
    unknown?: number;
  };
  external_communication_count?: number;
  highest_classification?: AgentClassification;
  total_span_types?: number;
  unassessed_span_types?: number;
}

export interface AgentRiskRollup {
  observed_risk?: AgentRiskSummary | null;
  theoretical_risk?: AgentRiskSummary | null;
}

export interface AgentShowDetails {
  available_actions?: AgentAvailableActions;
  description?: string | null;
  external_identifier?: string | null;
  id?: string;
  inserted_at?: string;
  instance_counts?: AgentInstanceCounts;
  last_activity_span_at?: string | null;
  name?: string;
  owner_person_id?: string | null;
  risk_profile_id?: string | null;
  status?: 'pending' | 'active' | 'dormant' | 'retired';
  team_id?: string | null;
  type?: 'agent';
  updated_at?: string;
}

export interface AgentShowParams {
  agent_id?: string;
  external_identifier?: string;
  environment_id?: string;
  include_counts?: boolean;
  include_risk_rollup?: boolean;
}

export interface AgentGetDetailsOutput {
  details?: AgentShowDetails;
  risk_rollup?: AgentRiskRollup | null;
  status?: 'success';
}

export class AgentClient {
  constructor(private readonly client: ApiClient) {}

  list(): Promise<AgentListResponse> {
    return this.client.request('/agent', {
      method: 'GET',
    });
  }

  retrieve(id: string): Promise<AgentResponse> {
    return this.client.request(`/agent/${id}`, { method: 'GET' });
  }

  show(params: AgentShowParams): Promise<AgentGetDetailsOutput> {
    return this.client.request('/agent/show', {
      method: 'GET',
      query: {
        ...(params.agent_id ? { agent_id: params.agent_id } : {}),
        ...(params.external_identifier ? { external_identifier: params.external_identifier } : {}),
        ...(params.environment_id ? { environment_id: params.environment_id } : {}),
        ...(params.include_counts !== undefined ? { include_counts: params.include_counts } : {}),
        ...(params.include_risk_rollup !== undefined
          ? { include_risk_rollup: params.include_risk_rollup }
          : {}),
      },
    });
  }

  create(details: AgentDetails & { name: string }): Promise<AgentResponse> {
    return this.client.request('/agent', {
      method: 'POST',
      body: { details },
    });
  }

  update(id: string, details: AgentDetails): Promise<AgentResponse> {
    return this.client.request(`/agent/${id}`, {
      method: 'PUT',
      body: { details },
    });
  }

  delete(id: string): Promise<void> {
    return this.client.request(`/agent/${id}`, { method: 'DELETE' });
  }

  retire(id: string): Promise<AgentResponse> {
    return this.client.request(`/agent/${id}/retire`, { method: 'POST', body: {} });
  }

  reinstate(id: string): Promise<AgentResponse> {
    return this.client.request(`/agent/${id}/reinstate`, { method: 'POST', body: {} });
  }
}
