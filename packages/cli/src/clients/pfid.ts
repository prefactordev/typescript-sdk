import type { ApiClient } from '../api-client.js';

export interface PfidDetails {
  pfids: string[];
}

export interface PfidResponse {
  details: PfidDetails;
}

export class PfidClient {
  constructor(private readonly client: ApiClient) {}

  generate(count = 1, accountId?: string): Promise<PfidResponse> {
    // PFID generate endpoint accepts non-details top-level arguments.
    return this.client.request('/pfid/generate', {
      method: 'POST',
      body: {
        count,
        ...(accountId ? { account_id: accountId } : {}),
      },
    });
  }
}
