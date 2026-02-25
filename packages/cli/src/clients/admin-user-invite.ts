import type { ApiClient } from '../api-client.js';

export interface AdminUserInvite {
  id: string;
  email: string;
  account_id: string;
  status: string;
}

export interface AdminUserInviteResponse {
  details: AdminUserInvite;
}

export interface AdminUserInviteListResponse {
  details: AdminUserInvite[];
}

export class AdminUserInviteClient {
  constructor(private readonly client: ApiClient) {}

  list(accountId?: string): Promise<AdminUserInviteListResponse> {
    return this.client.request('/admin_user_invite', {
      method: 'GET',
      query: accountId ? { account_id: accountId } : undefined,
    });
  }

  retrieve(id: string): Promise<AdminUserInviteResponse> {
    return this.client.request(`/admin_user_invite/${id}`, { method: 'GET' });
  }

  create(email: string, accountId?: string): Promise<AdminUserInviteResponse> {
    return this.client.request('/admin_user_invite', {
      method: 'POST',
      body: {
        details: {
          email,
          ...(accountId ? { account_id: accountId } : {}),
        },
      },
    });
  }

  revoke(id: string): Promise<AdminUserInviteResponse> {
    return this.client.request(`/admin_user_invite/${id}/revoke`, {
      method: 'POST',
      body: {},
    });
  }
}
