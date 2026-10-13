import type { ApiClient } from '../api-client.js';
import { type ListQueryParams, type ListResponse, listQuery } from './list-response.js';

export type KnowledgebaseStatus = 'active' | 'archived';

export interface KnowledgebaseSummary {
  id: string;
  type: 'knowledgebase';
  account_id: string;
  name: string;
  description: string | null;
  status: KnowledgebaseStatus;
  active_document_count: number;
  revision_number: number;
}

export type KnowledgebaseDetails = KnowledgebaseSummary;

export interface KnowledgebaseForCreate {
  name: string;
  account_id?: string;
  description?: string;
}

export interface KnowledgebaseForUpdate {
  name?: string;
  description?: string | null;
}

export interface KnowledgebaseListParams extends ListQueryParams {
  account_id?: string;
  status?: KnowledgebaseStatus;
}

export interface KnowledgebaseResponse {
  details: KnowledgebaseDetails;
  status: 'success';
}

export type KnowledgebaseListResponse = ListResponse<KnowledgebaseSummary>;

export class KnowledgebaseClient {
  constructor(private readonly client: ApiClient) {}

  list(params: KnowledgebaseListParams = {}): Promise<KnowledgebaseListResponse> {
    return this.client.request('/knowledgebase', {
      method: 'GET',
      query: {
        ...(params.account_id !== undefined ? { account_id: params.account_id } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...listQuery(params),
      },
    });
  }

  retrieve(id: string): Promise<KnowledgebaseResponse> {
    return this.client.request(knowledgebasePath(id), { method: 'GET' });
  }

  create(details: KnowledgebaseForCreate): Promise<KnowledgebaseResponse> {
    return this.client.request('/knowledgebase', {
      method: 'POST',
      body: { details },
    });
  }

  update(id: string, details: KnowledgebaseForUpdate): Promise<KnowledgebaseResponse> {
    return this.client.request(knowledgebasePath(id), {
      method: 'PUT',
      body: { details },
    });
  }

  archive(id: string): Promise<KnowledgebaseResponse> {
    return this.client.request(knowledgebasePath(id, '/archive'), { method: 'POST' });
  }

  unarchive(id: string): Promise<KnowledgebaseResponse> {
    return this.client.request(knowledgebasePath(id, '/unarchive'), { method: 'POST' });
  }

  delete(id: string): Promise<KnowledgebaseResponse> {
    return this.client.request(knowledgebasePath(id), { method: 'DELETE' });
  }
}

function knowledgebasePath(id: string, suffix = ''): string {
  return `/knowledgebase/${encodeURIComponent(id)}${suffix}`;
}
