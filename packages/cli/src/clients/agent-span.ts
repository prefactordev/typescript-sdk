import type { ApiClient } from '../api-client.js';

export interface AgentSpan {
  id: string;
  agent_instance_id: string;
  schema_name: string;
  status: string;
}

export interface AgentSpanListParams {
  agent_instance_id: string;
  start_time: string;
  end_time: string;
  include_summaries?: boolean;
}

export interface AgentSpanCreateDetails {
  agent_instance_id: string;
  schema_name?: string;
  status?: string;
  payload: Record<string, unknown>;
  id?: string;
  parent_span_id?: string;
  started_at?: string;
  finished_at?: string;
  result_payload?: Record<string, unknown>;
}

export interface AgentSpanFinishOptions {
  timestamp?: string;
  status?: string;
  result_payload?: Record<string, unknown>;
}

export interface AgentSpanResponse {
  details: AgentSpan;
}

export interface AgentSpanListResponse {
  details: AgentSpan[];
}

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
}
