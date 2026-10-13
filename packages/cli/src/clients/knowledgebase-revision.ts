import type { ApiClient } from '../api-client.js';
import { type ListQueryParams, type ListResponse, listQuery } from './list-response.js';

export interface KnowledgebaseRevisionSummary {
  id: string;
  type: 'knowledgebase_revision';
  knowledgebase_id: string;
  revision_number: number;
  document_count: number;
  total_size_bytes: number;
  current: boolean;
  created_by_admin_user_id: string | null;
  created_by_api_token_id: string | null;
  inserted_at: string;
}

export type KnowledgebaseRevisionDetails = KnowledgebaseRevisionSummary;

export interface KnowledgebaseRevisionDocument {
  knowledgebase_document_id: string;
  path: string;
  content_type: string;
  size_bytes: number;
  knowledgebase_document_revision_id: string;
}

export interface KnowledgebaseRevisionListParams extends ListQueryParams {
  knowledgebase_id: string;
}

export interface KnowledgebaseRevisionDocumentListParams extends ListQueryParams {
  path_prefix?: string;
}

export interface KnowledgebaseRevisionResponse {
  details: KnowledgebaseRevisionDetails;
  status: 'success';
}

export type KnowledgebaseRevisionListResponse = ListResponse<KnowledgebaseRevisionSummary>;

export type KnowledgebaseRevisionDocumentListResponse = ListResponse<KnowledgebaseRevisionDocument>;

export class KnowledgebaseRevisionClient {
  constructor(private readonly client: ApiClient) {}

  list(params: KnowledgebaseRevisionListParams): Promise<KnowledgebaseRevisionListResponse> {
    return this.client.request('/knowledgebase_revision', {
      method: 'GET',
      query: {
        knowledgebase_id: params.knowledgebase_id,
        ...listQuery(params),
      },
    });
  }

  retrieve(id: string): Promise<KnowledgebaseRevisionResponse> {
    return this.client.request(revisionPath(id), { method: 'GET' });
  }

  listDocuments(
    id: string,
    params: KnowledgebaseRevisionDocumentListParams = {}
  ): Promise<KnowledgebaseRevisionDocumentListResponse> {
    return this.client.request(revisionPath(id, '/documents'), {
      method: 'GET',
      query: {
        ...(params.path_prefix !== undefined ? { path_prefix: params.path_prefix } : {}),
        ...listQuery(params),
      },
    });
  }
}

function revisionPath(id: string, suffix = ''): string {
  return `/knowledgebase_revision/${encodeURIComponent(id)}${suffix}`;
}
