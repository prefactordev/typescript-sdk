import type { ApiClient } from '../api-client.js';

export interface AdminUser {
  id: string;
  email: string;
  account_id: string;
}

export interface AdminUserResponse {
  details: AdminUser;
}

export interface AdminUserListResponse {
  details: AdminUser[];
}

export class AdminUserClient {
  constructor(private readonly client: ApiClient) {}

  list(accountId?: string): Promise<AdminUserListResponse> {
    return this.client.request('/admin_user', {
      method: 'GET',
      query: accountId ? { account_id: accountId } : undefined,
    });
  }

  retrieve(id: string): Promise<AdminUserResponse> {
    return this.client.request(`/admin_user/${id}`, { method: 'GET' });
  }
}
