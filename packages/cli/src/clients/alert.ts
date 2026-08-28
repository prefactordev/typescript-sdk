import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export type AlertSeverity = 'critical' | 'error' | 'warning' | 'info';

export type AlertStatus = 'raised' | 'cleared';

export interface AlertDetails {
  account_id?: string;
  agent_id?: string;
  agent_instance_id?: string;
  cleared_at?: string | null;
  environment_id?: string;
  id?: string;
  inserted_at?: string;
  name?: string;
  payload?: Record<string, unknown>;
  payload_sensitive_encoding?: boolean;
  raised_at?: string;
  severity?: AlertSeverity;
  status?: AlertStatus;
  summary?: string | null;
  title?: string;
  type?: 'alert';
  updated_at?: string;
  version?: number;
}

export interface AlertSummary {
  account_id?: string;
  agent_id?: string;
  agent_instance_id?: string;
  cleared_at?: string | null;
  environment_id?: string;
  id?: string;
  inserted_at?: string;
  name?: string;
  raised_at?: string;
  severity?: AlertSeverity;
  status?: AlertStatus;
  summary?: string | null;
  title?: string;
  type?: 'alert';
  updated_at?: string;
  version?: number;
}

export interface AlertListParams {
  agent_instance_id?: string;
  agent_id?: string;
  environment_id?: string;
  status?: AlertStatus;
  severity?: AlertSeverity;
  name?: string;
  active_during?: {
    start_at?: string;
    finish_at?: string;
  };
  sorting?: string;
  pagination?: {
    offset?: number;
    page_size?: number;
  };
}

export interface AlertCountParams {
  status?: AlertStatus;
  severity?: AlertSeverity;
}

export interface AlertRaiseParams {
  agent_instance_id: string;
  name: string;
  severity: AlertSeverity;
  payload: Record<string, unknown>;
  raised_at?: string;
  payload_sensitive_encoding?: boolean;
}

export interface AlertClearParams {
  agent_instance_id: string;
  name: string;
  payload?: Record<string, unknown>;
  severity?: AlertSeverity;
  cleared_at?: string;
  payload_sensitive_encoding?: boolean;
}

export interface AlertResponse {
  details?: AlertDetails;
  status?: 'success';
}

export type AlertListResponse = ListResponse<AlertSummary>;

export interface AlertCountResponse {
  count?: number;
  status?: 'success';
}

export class AlertClient {
  constructor(private readonly client: ApiClient) {}

  list(params: AlertListParams = {}): Promise<AlertListResponse> {
    return this.client.request('/alerts', {
      method: 'GET',
      query: {
        ...(params.agent_instance_id ? { agent_instance_id: params.agent_instance_id } : {}),
        ...(params.agent_id ? { agent_id: params.agent_id } : {}),
        ...(params.environment_id ? { environment_id: params.environment_id } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.severity ? { severity: params.severity } : {}),
        ...(params.name ? { name: params.name } : {}),
        ...(params.active_during?.start_at
          ? { 'active_during[start_at]': params.active_during.start_at }
          : {}),
        ...(params.active_during?.finish_at
          ? { 'active_during[finish_at]': params.active_during.finish_at }
          : {}),
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

  retrieve(id: string): Promise<AlertResponse> {
    return this.client.request(`/alerts/${id}`, { method: 'GET' });
  }

  count(params: AlertCountParams = {}): Promise<AlertCountResponse> {
    return this.client.request('/alerts/count', {
      method: 'GET',
      query: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.severity ? { severity: params.severity } : {}),
      },
    });
  }

  raise(params: AlertRaiseParams): Promise<AlertResponse> {
    return this.client.request('/alerts/raise', {
      method: 'POST',
      body: params,
    });
  }

  clear(params: AlertClearParams): Promise<AlertResponse> {
    return this.client.request('/alerts/clear', {
      method: 'POST',
      body: params,
    });
  }
}
