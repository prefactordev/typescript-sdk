import type { ApiClient } from '../api-client.js';

export interface ApiToken {
  id: string;
  token_scope: string;
  account_id: string;
  agent_deployment_id: string | null;
  agent_id: string | null;
  environment_id: string | null;
  expires_at: string;
  last_used_at: string | null;
  status: string;
}

export interface ApiTokenCreateDetails {
  token_scope: string;
  account_id?: string;
  agent_id?: string;
  environment_id?: string;
  expires_at?: string;
}

export interface ApiTokenResponse {
  details: ApiToken;
}

export interface ApiTokenWithValue extends ApiToken {
  token: string;
}

export interface ApiTokenCreateResponse {
  details: ApiTokenWithValue;
}

export interface ApiTokenListResponse {
  details: ApiToken[];
}

export class ApiTokenClient {
  constructor(private readonly client: ApiClient) {}

  list(accountId?: string): Promise<ApiTokenListResponse> {
    return this.client.request('/api_token', {
      method: 'GET',
      query: accountId ? { account_id: accountId } : undefined,
    });
  }

  retrieve(id: string): Promise<ApiTokenResponse> {
    return this.client.request(`/api_token/${id}`, { method: 'GET' });
  }

  async create(details: ApiTokenCreateDetails): Promise<ApiTokenCreateResponse> {
    const response = await this.client.request<{ details: ApiToken; token: string }>(
      '/api_token',
      {
        method: 'POST',
        body: { details },
      }
    );

    return {
      details: {
        ...response.details,
        token: response.token,
      },
    };
  }

  suspend(id: string): Promise<ApiTokenResponse> {
    return this.client.request(`/api_token/${id}/suspend`, { method: 'POST', body: {} });
  }

  activate(id: string): Promise<ApiTokenResponse> {
    return this.client.request(`/api_token/${id}/activate`, { method: 'POST', body: {} });
  }

  revoke(id: string): Promise<ApiTokenResponse> {
    return this.client.request(`/api_token/${id}/revoke`, { method: 'POST', body: {} });
  }

  delete(id: string): Promise<void> {
    return this.client.request(`/api_token/${id}`, { method: 'DELETE' });
  }
}
