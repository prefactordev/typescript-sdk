import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface PersonDetails {
  email: string;
  id: string;
  inserted_at: string;
  name: string;
  team_ids: string[];
  title: string | null;
  type: 'person';
  updated_at: string;
}

export interface PersonSummary {
  email: string;
  id: string;
  name: string;
  team_ids: string[];
  title: string | null;
  type: 'person';
}

export interface PersonForCreate {
  email: string;
  name: string;
  id?: string;
  team_ids?: string[];
  title?: string | null;
}

export interface PersonForUpdate {
  email?: string;
  name?: string;
  team_ids?: string[];
  title?: string | null;
}

export interface PersonListParams {
  team_id?: string;
  sorting?: string;
  pagination?: {
    offset?: number;
    page_size?: number;
  };
}

export interface PersonResponse {
  details: PersonDetails;
  status: 'success';
}

export type PersonListResponse = ListResponse<PersonSummary>;

export class PersonClient {
  constructor(private readonly client: ApiClient) {}

  list(params: PersonListParams = {}): Promise<PersonListResponse> {
    return this.client.request('/person', {
      method: 'GET',
      query: {
        ...(params.team_id ? { team_id: params.team_id } : {}),
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

  retrieve(id: string): Promise<PersonResponse> {
    return this.client.request(`/person/${id}`, { method: 'GET' });
  }

  create(details: PersonForCreate): Promise<PersonResponse> {
    return this.client.request('/person', {
      method: 'POST',
      body: { details },
    });
  }

  update(id: string, details: PersonForUpdate): Promise<PersonResponse> {
    return this.client.request(`/person/${id}`, {
      method: 'PUT',
      body: { details },
    });
  }

  delete(id: string): Promise<PersonResponse> {
    return this.client.request(`/person/${id}`, { method: 'DELETE' });
  }
}
