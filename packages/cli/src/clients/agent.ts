import type { ApiClient } from '../api-client.js';

export interface Agent {
  id: string;
  name: string;
  environment_id: string;
  description?: string;
  status: string;
}

export interface AgentDetails {
  id?: string;
  name?: string;
  description?: string;
  current_version_id?: string;
  environment_id?: string;
}

export interface AgentResponse {
  details: Agent;
}

export interface AgentListResponse {
  details: Agent[];
}

export class AgentClient {
  constructor(private readonly client: ApiClient) {}

  list(environmentId: string): Promise<AgentListResponse> {
    return this.client.request('/agent', {
      method: 'GET',
      query: { environment_id: environmentId },
    });
  }

  retrieve(id: string): Promise<AgentResponse> {
    return this.client.request(`/agent/${id}`, { method: 'GET' });
  }

  create(details: AgentDetails & { environment_id: string }): Promise<AgentResponse> {
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
