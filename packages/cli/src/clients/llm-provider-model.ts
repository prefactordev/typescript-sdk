import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface LlmProviderModelDetails {
  api_name: string;
  id: string;
  llm_provider_id: string;
  models_dev_model_name: string | null;
  models_dev_provider: string | null;
  name: string;
  type: 'llm_provider_model';
}

export type LlmProviderModelSummary = LlmProviderModelDetails;

export interface LlmProviderModelForCreate {
  llm_provider_id: string;
  api_name: string;
  name?: string;
  models_dev_provider?: string;
  models_dev_model_name?: string;
  id?: string;
}

export interface LlmProviderModelForUpdate {
  api_name?: string;
  name?: string;
  models_dev_provider?: string;
  models_dev_model_name?: string;
}

export interface LlmProviderModelResponse {
  details: LlmProviderModelDetails;
  status: 'success';
}

export type LlmProviderModelListResponse = ListResponse<LlmProviderModelSummary>;

export class LlmProviderModelClient {
  constructor(private readonly client: ApiClient) {}

  list(llmProviderId: string): Promise<LlmProviderModelListResponse> {
    return this.client.request('/llm_provider_model', {
      method: 'GET',
      query: { llm_provider_id: llmProviderId },
    });
  }

  retrieve(id: string): Promise<LlmProviderModelResponse> {
    return this.client.request(`/llm_provider_model/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }

  create(details: LlmProviderModelForCreate): Promise<LlmProviderModelResponse> {
    return this.client.request('/llm_provider_model', { method: 'POST', body: { details } });
  }

  update(id: string, details: LlmProviderModelForUpdate): Promise<LlmProviderModelResponse> {
    return this.client.request(`/llm_provider_model/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { details },
    });
  }

  delete(id: string): Promise<LlmProviderModelResponse> {
    return this.client.request(`/llm_provider_model/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
