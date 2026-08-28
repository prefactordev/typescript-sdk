import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface AdminUser {
  id: string;
  email: string;
  account_id: string;
}

export interface AdminUserSummary {
  account_id: string;
  email: string;
  id: string;
  inserted_at: string;
  job_title: string | null;
  last_active_at: string | null;
  name: string | null;
  profile_completed_at: string | null;
  type: 'admin_user';
  updated_at: string;
}

export interface AdminUserResponse {
  details: AdminUser;
}

export type AdminUserListResponse = ListResponse<AdminUserSummary>;

export interface AdminUserDetailsForUpdate {
  job_title?: string | null;
  name?: string;
  profile_completed_at?: string | null;
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

  update(id: string, details: AdminUserDetailsForUpdate): Promise<AdminUserResponse> {
    return this.client.request(`/admin_user/${id}`, {
      method: 'PUT',
      body: { details },
    });
  }
}
