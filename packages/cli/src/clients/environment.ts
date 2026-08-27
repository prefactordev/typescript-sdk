import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface Environment {
  id: string;
  name: string;
  account_id: string;
}

export interface EnvironmentSummary {
  account_id?: string;
  description?: string | null;
  external_identifier?: string | null;
  id?: string;
  name?: string;
  purpose?: 'development' | 'staging' | 'testing' | 'production';
  type?: 'environment';
}

export interface EnvironmentDetails {
  id?: string;
  name?: string;
  account_id?: string;
}

export interface EnvironmentResponse {
  details: Environment;
}

export type EnvironmentListResponse = ListResponse<EnvironmentSummary>;

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
