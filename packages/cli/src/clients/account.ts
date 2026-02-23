import type { ApiClient } from '../api-client.js';

export interface Account {
  id: string;
  name: string;
}

export interface AccountDetails {
  name?: string;
}

export interface AccountResponse {
  details: Account;
}

export interface AccountListResponse {
  details: Account[];
}

export class AccountClient {
  constructor(private readonly client: ApiClient) {}

  list(): Promise<AccountListResponse> {
    return this.client.request('/account', { method: 'GET' });
  }

  retrieve(id: string): Promise<AccountResponse> {
    return this.client.request(`/account/${id}`, { method: 'GET' });
  }

  update(id: string, details: AccountDetails): Promise<AccountResponse> {
    return this.client.request(`/account/${id}`, {
      method: 'PUT',
      body: { details },
    });
  }
}
