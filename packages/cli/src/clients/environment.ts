import type { ApiClient } from '../api-client.js';

export interface Environment {
  id: string;
  name: string;
  account_id: string;
}

export interface EnvironmentDetails {
  id?: string;
  name?: string;
  account_id?: string;
}

export interface EnvironmentResponse {
  details: Environment;
}

export interface EnvironmentListResponse {
  details: Environment[];
}

export class EnvironmentClient {
  constructor(private readonly client: ApiClient) {}

  list(accountId: string): Promise<EnvironmentListResponse> {
    return this.client.request('/environment', {
      method: 'GET',
      query: { account_id: accountId },
    });
  }

  retrieve(id: string): Promise<EnvironmentResponse> {
    return this.client.request(`/environment/${id}`, { method: 'GET' });
  }

  create(details: EnvironmentDetails & { account_id: string }): Promise<EnvironmentResponse> {
    return this.client.request('/environment', {
      method: 'POST',
      body: { details },
    });
  }

  update(id: string, details: Partial<EnvironmentDetails>): Promise<EnvironmentResponse> {
    return this.client.request(`/environment/${id}`, {
      method: 'PUT',
      body: { details },
    });
  }

  delete(id: string): Promise<void> {
    return this.client.request(`/environment/${id}`, { method: 'DELETE' });
  }
}
