import type { HttpRequester } from '@prefactor/core';

export interface AgentSummary {
  id: string;
  name: string;
}

export interface AgentDeploymentSummary {
  environment_id: string;
  current_version_id: string | null;
}

export interface EnvironmentSummary {
  id: string;
  name: string;
}

export interface PingDetails {
  token_type?: string;
  account_id?: string;
  agent_id?: string;
  environment_id?: string;
  agent_deployment_id?: string;
  api_token_id?: string;
}

type ListResponse<T> = {
  summaries?: T[];
  pagination?: { next_page_offset: number | null } | null;
};

/**
 * The Prefactor API calls `/prefactor setup` makes.
 */
export class PrefactorApi {
  constructor(private readonly client: HttpRequester) {}

  async ping(): Promise<PingDetails> {
    const response = await this.client.request<{ details?: PingDetails }>('/api/v1/ping', {
      method: 'GET',
    });
    return response.details ?? {};
  }

  listAgents(): Promise<AgentSummary[]> {
    return this.listAll<AgentSummary>('/api/v1/agent', { role: 'standard' });
  }

  async createAgent(name: string, description: string): Promise<AgentSummary> {
    const response = await this.client.request<{ details: AgentSummary }>('/api/v1/agent', {
      method: 'POST',
      body: { details: { name, description } },
    });
    return response.details;
  }

  listDeployments(agentId: string): Promise<AgentDeploymentSummary[]> {
    return this.listAll<AgentDeploymentSummary>('/api/v1/agent_deployment', { agent_id: agentId });
  }

  listEnvironments(accountId: string): Promise<EnvironmentSummary[]> {
    return this.listAll<EnvironmentSummary>('/api/v1/environment', { account_id: accountId });
  }

  /** Creates an agent-deployment token and returns its value. */
  async createDeploymentToken(agentId: string, environmentId: string): Promise<string> {
    const response = await this.client.request<{ token?: string }>('/api/v1/api_token', {
      method: 'POST',
      body: {
        details: {
          token_scope: 'agent_deployment',
          agent_id: agentId,
          environment_id: environmentId,
        },
      },
    });
    if (!response.token) {
      throw new Error('Creating the deployment token returned no token.');
    }
    return response.token;
  }

  async revokeToken(tokenId: string): Promise<void> {
    await this.client.request(`/api/v1/api_token/${tokenId}/revoke`, { method: 'POST', body: {} });
  }

  private async listAll<T>(path: string, query: Record<string, string>): Promise<T[]> {
    const items: T[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const params = new URLSearchParams({ ...query, 'pagination[offset]': String(offset) });
      const response: ListResponse<T> = await this.client.request<ListResponse<T>>(
        `${path}?${params}`,
        { method: 'GET' }
      );
      items.push(...(response.summaries ?? []));
      offset = response.pagination?.next_page_offset ?? null;
    }
    return items;
  }
}
