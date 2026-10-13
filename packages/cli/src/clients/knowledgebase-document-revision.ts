import type { ApiClient } from '../api-client.js';
import { type ListQueryParams, type ListResponse, listQuery } from './list-response.js';

export type KnowledgebaseDocumentChangeKind =
  | 'create'
  | 'update'
  | 'rename'
  | 'archive'
  | 'unarchive';

export interface KnowledgebaseDocumentRevisionSummary {
  id: string;
  type: 'knowledgebase_document_revision';
  knowledgebase_document_id: string;
  revision_number: number;
  knowledgebase_revision_number: number;
  change_kind: KnowledgebaseDocumentChangeKind;
  path: string;
  content_type: string;
  size_bytes: number;
  content_sha256: string;
  created_by_admin_user_id: string | null;
  created_by_api_token_id: string | null;
  inserted_at: string;
}

export interface KnowledgebaseDocumentRevisionDetails extends KnowledgebaseDocumentRevisionSummary {
  content: string;
}

export interface KnowledgebaseDocumentRevisionListParams extends ListQueryParams {
  knowledgebase_document_id: string;
}

export interface KnowledgebaseDocumentRevisionResponse {
  details: KnowledgebaseDocumentRevisionDetails;
  status: 'success';
}

export type KnowledgebaseDocumentRevisionListResponse =
  ListResponse<KnowledgebaseDocumentRevisionSummary>;

export class KnowledgebaseDocumentRevisionClient {
  constructor(private readonly client: ApiClient) {}

  list(
    params: KnowledgebaseDocumentRevisionListParams
  ): Promise<KnowledgebaseDocumentRevisionListResponse> {
    return this.client.request('/knowledgebase_document_revision', {
      method: 'GET',
      query: {
        knowledgebase_document_id: params.knowledgebase_document_id,
        ...listQuery(params),
      },
    });
  }

  retrieve(id: string): Promise<KnowledgebaseDocumentRevisionResponse> {
    return this.client.request(`/knowledgebase_document_revision/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }
}
