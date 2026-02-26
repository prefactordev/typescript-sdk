import type { ApiClient, ApiClientMethod } from '../api-client.js';

export interface BulkItem {
  method: ApiClientMethod;
  path: string;
  body?: Record<string, unknown>;
}

export interface BulkResponseItem {
  status: number;
  body: unknown;
}

export interface BulkDetails {
  items: BulkResponseItem[];
}

export interface BulkResponse {
  details: BulkDetails;
}

export class BulkClient {
  constructor(private readonly client: ApiClient) {}

  execute(items: BulkItem[]): Promise<BulkResponse> {
    // Bulk endpoint expects top-level `items`, not a `details` wrapper.
    return this.client.request('/bulk', {
      method: 'POST',
      body: { items },
    });
  }
}
