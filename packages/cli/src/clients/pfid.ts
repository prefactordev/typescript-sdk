import type { ApiClient } from '../api-client.js';

export interface PfidResponse {
  account_id: string;
  pfids: string[];
  status: 'success';
}

export class PfidClient {
  constructor(private readonly client: ApiClient) {}

  generate(count = 1, accountId?: string): Promise<PfidResponse> {
    return this.client.request('/pfid/generate', {
      method: 'POST',
      body: {
        count,
        ...(accountId ? { account_id: accountId } : {}),
      },
    });
  }
}
