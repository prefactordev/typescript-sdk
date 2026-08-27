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
