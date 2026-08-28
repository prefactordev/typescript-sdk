import type { ApiClient } from '../api-client.js';

export interface BulkItem {
  _type: string;
  idempotency_key: string;
  [key: string]: unknown;
}

export interface BulkResponse {
  outputs: Record<string, Record<string, unknown>>;
  status: 'success';
}

export class BulkClient {
  constructor(private readonly client: ApiClient) {}

  execute(items: BulkItem[]): Promise<BulkResponse> {
    return this.client.request('/bulk', {
      method: 'POST',
      body: { items },
    });
  }
}
