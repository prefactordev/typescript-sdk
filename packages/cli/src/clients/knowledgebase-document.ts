import type { ApiClient } from '../api-client.js';
import type { KnowledgebaseStatus } from './knowledgebase.js';
import { type ListQueryParams, type ListResponse, listQuery } from './list-response.js';

export interface KnowledgebaseDocumentSummary {
  id: string;
  type: 'knowledgebase_document';
  knowledgebase_id: string;
  path: string;
  content_type: string;
  size_bytes: number;
  content_sha256: string;
  status: KnowledgebaseStatus;
  latest_revision_id: string;
  latest_revision_number: number;
}

export interface KnowledgebaseDocumentDetails extends KnowledgebaseDocumentSummary {
  content: string;
}

export interface KnowledgebaseDocumentForCreate {
  knowledgebase_id: string;
  path: string;
  content: string;
  content_type?: string;
}

export interface KnowledgebaseDocumentForUpdate {
  content?: string;
  content_type?: string;
}

export interface KnowledgebaseDocumentUpdateInput {
  base_revision_id: string;
  details: KnowledgebaseDocumentForUpdate;
}

export interface KnowledgebaseDocumentRevisionInput {
  base_revision_id: string;
  path?: string;
}

export interface KnowledgebaseDocumentListParams extends ListQueryParams {
  knowledgebase_id: string;
  path_prefix?: string;
  status?: KnowledgebaseStatus;
}

export interface KnowledgebaseDocumentResponse {
  details: KnowledgebaseDocumentDetails;
  status: 'success';
}

export type KnowledgebaseDocumentListResponse = ListResponse<KnowledgebaseDocumentSummary>;

export class KnowledgebaseDocumentClient {
  constructor(private readonly client: ApiClient) {}

  list(params: KnowledgebaseDocumentListParams): Promise<KnowledgebaseDocumentListResponse> {
    return this.client.request('/knowledgebase_document', {
      method: 'GET',
      query: {
        knowledgebase_id: params.knowledgebase_id,
        ...(params.path_prefix !== undefined ? { path_prefix: params.path_prefix } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...listQuery(params),
      },
    });
  }

  retrieve(id: string): Promise<KnowledgebaseDocumentResponse> {
    return this.client.request(documentPath(id), { method: 'GET' });
  }

  create(details: KnowledgebaseDocumentForCreate): Promise<KnowledgebaseDocumentResponse> {
    return this.client.request('/knowledgebase_document', {
      method: 'POST',
      body: { details },
    });
  }

  update(
    id: string,
    input: KnowledgebaseDocumentUpdateInput
  ): Promise<KnowledgebaseDocumentResponse> {
    return this.client.request(documentPath(id), {
      method: 'PUT',
      body: input,
    });
  }

  rename(
    id: string,
    input: Required<KnowledgebaseDocumentRevisionInput>
  ): Promise<KnowledgebaseDocumentResponse> {
    return this.client.request(documentPath(id, '/rename'), {
      method: 'POST',
      body: input,
    });
  }

  archive(id: string, input: { base_revision_id: string }): Promise<KnowledgebaseDocumentResponse> {
    return this.client.request(documentPath(id, '/archive'), {
      method: 'POST',
      body: input,
    });
  }

  unarchive(
    id: string,
    input: KnowledgebaseDocumentRevisionInput
  ): Promise<KnowledgebaseDocumentResponse> {
    return this.client.request(documentPath(id, '/unarchive'), {
      method: 'POST',
      body: {
        base_revision_id: input.base_revision_id,
        ...(input.path !== undefined ? { path: input.path } : {}),
      },
    });
  }

  delete(id: string): Promise<KnowledgebaseDocumentResponse> {
    return this.client.request(documentPath(id), { method: 'DELETE' });
  }
}

function documentPath(id: string, suffix = ''): string {
  return `/knowledgebase_document/${encodeURIComponent(id)}${suffix}`;
}
