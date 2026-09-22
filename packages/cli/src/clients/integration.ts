import type { ApiClient } from '../api-client.js';

export interface IntegrationSummary {
  id: string;
  type: 'account_integration';
  integration_type: string;
  status: 'active' | 'paused';
}

export interface IntegrationDetails extends IntegrationSummary {
  config: Record<string, unknown>;
}

export interface IntegrationResponse {
  details: IntegrationDetails;
  status: 'success';
}

export interface IntegrationListResponse {
  summaries: IntegrationSummary[];
  status: 'success';
}

export interface IntegrationTestResponse {
  delivered: boolean;
  status: 'success';
}

export interface IntegrationForCreate {
  integration_type: string;
  status: 'active' | 'paused';
  config: Record<string, unknown>;
}

export interface IntegrationForUpdate {
  status?: 'active' | 'paused';
  config?: Record<string, unknown>;
}

/** Typed access to account integrations. Resource operations use integration IDs. */
export class IntegrationClient {
  constructor(private readonly client: ApiClient) {}

  /** List integrations belonging to the authenticated account. */
  list(): Promise<IntegrationListResponse> {
    return this.client.request('/account_integration', { method: 'GET' });
  }

  /** Retrieve configuration with secrets redacted by the API. */
  retrieve(id: string): Promise<IntegrationResponse> {
    return this.client.request(`/account_integration/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  /** Create an account integration. */
  create(details: IntegrationForCreate): Promise<IntegrationResponse> {
    return this.client.request('/account_integration', { method: 'POST', body: { details } });
  }

  /** Replace configuration or change the status of an existing integration. */
  update(id: string, details: IntegrationForUpdate): Promise<IntegrationResponse> {
    return this.client.request(`/account_integration/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { details },
    });
  }

  /** Remove an integration and return the API result. */
  delete(id: string): Promise<IntegrationResponse> {
    return this.client.request(`/account_integration/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /** Send a test notification and return the delivery result. */
  test(id: string): Promise<IntegrationTestResponse> {
    return this.client.request(`/account_integration/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    });
  }
}
