import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface Account {
  id: string;
  name: string;
}

export interface AccountSummary {
  id?: string;
  name?: string;
  type?: 'account';
}

export interface AccountDetails {
  name?: string;
}

export interface AccountResponse {
  details: Account;
}

export type AccountListResponse = ListResponse<AccountSummary>;

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
