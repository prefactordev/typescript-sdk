import type { ListResponse } from './list-response.js';

export {
  AgentInstanceClient,
  type AgentInstanceFinishOptions,
  type AgentInstanceRegisterPayload as AgentInstanceRegistrationPayload,
  type AgentInstanceResponse,
  type AgentInstanceTerminateOptions,
} from '@prefactor/core';

export interface AgentInstance {
  id: string;
  agent_id: string;
  agent_deployment_id: string;
  status: string;
}

export interface AgentInstanceSummary {
  account_id?: string;
  agent_id?: string;
  agent_version_id?: string;
  environment_id?: string;
  external_identifier?: string | null;
  finished_at?: string | null;
  id?: string;
  inserted_at?: string;
  last_activity_span_at?: string | null;
  purpose?: 'live' | 'smoke_test' | 'eval';
  raised_alert_count?: number | null;
  risk_score?: Record<string, unknown> | null;
  started_at?: string | null;
  status?: 'pending' | 'active' | 'complete' | 'failed' | 'cancelled' | 'terminated';
  termination_reason?: string | null;
  type?: 'agent_instance';
  updated_at?: string;
}

export type AgentInstanceListResponse = ListResponse<AgentInstanceSummary>;
