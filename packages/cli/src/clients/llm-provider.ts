import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export type LlmProviderKind =
  | 'anthropic'
  | 'openai'
  | 'ollama_cloud'
  | 'together'
  | 'custom_openai';

export interface LlmProviderDetails {
  account_id: string;
  api_base_url: string | null;
  api_type: 'claude' | 'openai';
  id: string;
  name: string;
  provider: LlmProviderKind;
  type: 'llm_provider';
}

export type LlmProviderSummary = LlmProviderDetails;

export interface LlmProviderForCreate {
  name: string;
  provider: LlmProviderKind;
  api_key: string;
  api_base_url?: string;
  account_id?: string;
  id?: string;
}

export interface LlmProviderForUpdate {
  name?: string;
  api_key?: string;
  api_base_url?: string;
}

export interface LlmProviderResponse {
  details: LlmProviderDetails;
  status: 'success';
}

export type LlmProviderListResponse = ListResponse<LlmProviderSummary>;

export class LlmProviderClient {
  constructor(private readonly client: ApiClient) {}

  list(params: { account_id?: string } = {}): Promise<LlmProviderListResponse> {
    return this.client.request('/llm_provider', {
      method: 'GET',
      query: { ...(params.account_id ? { account_id: params.account_id } : {}) },
    });
  }

  retrieve(id: string): Promise<LlmProviderResponse> {
    return this.client.request(`/llm_provider/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  create(details: LlmProviderForCreate): Promise<LlmProviderResponse> {
    return this.client.request('/llm_provider', { method: 'POST', body: { details } });
  }

  update(id: string, details: LlmProviderForUpdate): Promise<LlmProviderResponse> {
    return this.client.request(`/llm_provider/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { details },
    });
  }

  delete(id: string): Promise<LlmProviderResponse> {
    return this.client.request(`/llm_provider/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
