import type { ApiClient } from '../api-client.js';

export interface AgentDeployment {
  id: string;
  type: string;
  account_id: string;
  agent_id: string;
  environment_id: string;
  current_version_id: string | null;
  inserted_at: string;
  updated_at: string;
}

export interface AgentDeploymentCreateDetails {
  agent_id: string;
  environment_id: string;
  id?: string;
  current_version_id?: string;
}

export interface AgentDeploymentUpdateDetails {
  current_version_id?: string | null;
}

export interface AgentDeploymentResponse {
  details: AgentDeployment;
}

export interface AgentDeploymentListResponse {
  details: AgentDeployment[];
}

export class AgentDeploymentClient {
  constructor(private readonly client: ApiClient) {}

  list(agentId: string): Promise<AgentDeploymentListResponse> {
    return this.client.request('/agent_deployment', {
      method: 'GET',
      query: { agent_id: agentId },
    });
  }

  retrieve(id: string): Promise<AgentDeploymentResponse> {
    return this.client.request(`/agent_deployment/${id}`, { method: 'GET' });
  }

  create(details: AgentDeploymentCreateDetails): Promise<AgentDeploymentResponse> {
    return this.client.request('/agent_deployment', {
      method: 'POST',
      body: { details },
    });
  }

  update(id: string, details: AgentDeploymentUpdateDetails): Promise<AgentDeploymentResponse> {
    return this.client.request(`/agent_deployment/${id}`, {
      method: 'PUT',
      body: { details },
    });
  }

  delete(id: string): Promise<AgentDeploymentResponse> {
    return this.client.request(`/agent_deployment/${id}`, { method: 'DELETE' });
  }
}
