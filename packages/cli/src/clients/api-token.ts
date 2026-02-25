import type { ApiClient } from '../api-client.js';

export interface ApiToken {
  id: string;
  token_scope: string;
  account_id?: string;
  environment_id?: string;
  expires_at?: string;
  status: string;
}

export interface ApiTokenCreateDetails {
  token_scope: string;
  account_id?: string;
  environment_id?: string;
  expires_at?: string;
}

export interface ApiTokenResponse {
  details: ApiToken;
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

  create(details: ApiTokenCreateDetails): Promise<ApiTokenResponse> {
    return this.client.request('/api_token', {
      method: 'POST',
      body: { details },
    });
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
