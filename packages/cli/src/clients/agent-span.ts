import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface AgentSpan {
  id: string;
  agent_instance_id: string;
  schema_name: string;
  status: 'active' | 'complete' | 'failed' | 'cancelled';
  account_id: string;
  agent_id: string;
  data_risk: Record<string, unknown> | null;
  finished_at: string | null;
  parent_span_id: string | null;
  payload: Record<string, unknown>;
  payload_byte_size_estimate: number;
  purpose: 'activity' | 'quality' | 'alert';
  result_payload: Record<string, unknown> | null;
  schema_title: string;
  sensitive_encoding: boolean;
  started_at: string;
  summary: string | null;
  type: 'agent_span';
}

export interface AgentSpanSummary {
  account_id: string;
  agent_id: string;
  agent_instance_id: string;
  data_risk: Record<string, unknown> | null;
  finished_at: string | null;
  id: string;
  parent_span_id: string | null;
  payload: Record<string, unknown>;
  payload_byte_size_estimate: number;
  purpose: 'activity' | 'quality' | 'alert';
  result_payload: Record<string, unknown> | null;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | null;
  risk_score: number | null;
  schema_name: string;
  schema_title: string;
  sensitive_encoding: boolean;
  started_at: string;
  status: 'active' | 'complete' | 'failed' | 'cancelled';
  summary: string | null;
  type: 'agent_span';
}

export interface AgentSpanListParams {
  agent_instance_id: string;
  start_time: string;
  end_time: string;
  include_summaries?: boolean;
}

export interface AgentSpanCreateDetails {
  agent_instance_id: string;
  schema_name: string;
  status: 'active' | 'complete' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  id?: string;
  parent_span_id?: string;
  started_at?: string;
  finished_at?: string;
  result_payload?: Record<string, unknown>;
}

export interface AgentSpanFinishOptions {
  timestamp?: string;
  status?: 'complete' | 'failed' | 'cancelled';
  result_payload?: Record<string, unknown>;
}

export interface AgentSpanResponse {
  details: AgentSpan;
  status: 'success';
}

export interface AgentSpanRetrieveOptions {
  redacted?: boolean;
}

export type AgentSpanListResponse = ListResponse<AgentSpanSummary>;

export type AgentSpanFinishResponse = Record<string, unknown>;

export class AgentSpanClient {
  constructor(private readonly client: ApiClient) {}

  list(params: AgentSpanListParams): Promise<AgentSpanListResponse> {
    return this.client.request('/agent_spans', {
      method: 'GET',
      query: {
        agent_instance_id: params.agent_instance_id,
        start_time: params.start_time,
        end_time: params.end_time,
        ...(params.include_summaries !== undefined
          ? { include_summaries: params.include_summaries }
          : {}),
      },
    });
  }

  retrieve(id: string, options: AgentSpanRetrieveOptions = {}): Promise<AgentSpanResponse> {
    return this.client.request(`/agent_spans/${id}`, {
      method: 'GET',
      query: {
        ...(options.redacted !== undefined ? { redacted: options.redacted } : {}),
      },
    });
  }

  create(details: AgentSpanCreateDetails): Promise<AgentSpanResponse> {
    return this.client.request('/agent_spans', {
      method: 'POST',
      body: { details },
    });
  }

  finish(id: string, options: AgentSpanFinishOptions = {}): Promise<AgentSpanFinishResponse> {
    return this.client.request(`/agent_spans/${id}/finish`, {
      method: 'POST',
      body: options,
    });
  }

  discardSensitive(id: string): Promise<AgentSpanResponse> {
    return this.client.request(`/agent_spans/${id}/discard_sensitive`, {
      method: 'POST',
      body: {},
    });
  }
}
