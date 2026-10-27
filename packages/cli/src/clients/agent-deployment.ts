import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

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

export interface AgentDeploymentSummary {
  account_id: string;
  agent_id: string;
  current_version_id: string | null;
  environment_id: string;
  id: string;
  inserted_at: string;
  type: 'agent_deployment';
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

export type AgentDeploymentListResponse = ListResponse<AgentDeploymentSummary>;

export interface AgentDeploymentPromotion {
  agent_version_id: string;
  source_agent_deployment_id: string;
  source_environment_id: string;
  target_agent_deployment_id: string | null;
  target_environment_id: string;
}

export interface AgentDeploymentPromotionListResponse {
  promotions: AgentDeploymentPromotion[];
  status: 'success';
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

  /** Lists deployments of a hosted agent that can move to the next environment. */
  listPromotions(agentId: string): Promise<AgentDeploymentPromotionListResponse> {
    return this.client.request('/agent_deployment/promotions', {
      method: 'GET',
      query: { agent_id: agentId },
    });
  }

  /** Pins this deployment's current version in the next environment. */
  promote(id: string): Promise<AgentDeploymentResponse> {
    return this.client.request(`/agent_deployment/${id}/promote`, { method: 'POST', body: {} });
  }
}
