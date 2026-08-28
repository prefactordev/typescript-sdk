import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface TeamDetails {
  agent_count?: number;
  id?: string;
  inserted_at?: string;
  name?: string;
  people_count?: number;
  type?: 'team';
  updated_at?: string;
}

export interface TeamSummary {
  agent_count?: number;
  id?: string;
  name?: string;
  people_count?: number;
  type?: 'team';
}

export interface TeamForCreate {
  name: string;
  id?: string;
}

export interface TeamForUpdate {
  name?: string;
}

export interface TeamListParams {
  sorting?: string;
  pagination?: {
    offset?: number;
    page_size?: number;
  };
}

export interface TeamResponse {
  details?: TeamDetails;
  status?: 'success';
}

export type TeamListResponse = ListResponse<TeamSummary>;

export class TeamClient {
  constructor(private readonly client: ApiClient) {}

  list(params: TeamListParams = {}): Promise<TeamListResponse> {
    return this.client.request('/team', {
      method: 'GET',
      query: {
        ...(params.sorting ? { sorting: params.sorting } : {}),
        ...(params.pagination?.offset !== undefined
          ? { 'pagination[offset]': params.pagination.offset }
          : {}),
        ...(params.pagination?.page_size !== undefined
          ? { 'pagination[page_size]': params.pagination.page_size }
          : {}),
      },
    });
  }

  retrieve(id: string): Promise<TeamResponse> {
    return this.client.request(`/team/${id}`, { method: 'GET' });
  }

  create(details: TeamForCreate): Promise<TeamResponse> {
    return this.client.request('/team', {
      method: 'POST',
      body: { details },
    });
  }

  update(id: string, details: TeamForUpdate): Promise<TeamResponse> {
    return this.client.request(`/team/${id}`, {
      method: 'PUT',
      body: { details },
    });
  }

  delete(id: string): Promise<TeamResponse> {
    return this.client.request(`/team/${id}`, { method: 'DELETE' });
  }
}
