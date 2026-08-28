import type { ApiClient } from '../api-client.js';
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

export type AgentInstanceDataCategory =
  | 'personal_identifiers'
  | 'contact_information'
  | 'financial_information'
  | 'health_and_medical'
  | 'criminal_justice'
  | 'authentication_and_secrets'
  | 'organisational_confidential'
  | 'minors_data'
  | 'location_and_tracking'
  | 'behavioural_and_inferred'
  | 'gdpr_racial_or_ethnic_origin'
  | 'gdpr_political_opinions'
  | 'gdpr_religious_or_philosophical_beliefs'
  | 'gdpr_trade_union_membership'
  | 'gdpr_genetic_data'
  | 'gdpr_biometric_for_identification'
  | 'gdpr_sex_life_or_sexual_orientation';

export type AgentInstanceAllowedAction =
  | 'create_data'
  | 'read_data'
  | 'update_data'
  | 'destroy_data'
  | 'financial_transactions'
  | 'external_communication';

export type AgentInstanceRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type AgentInstanceClassification =
  | 'unknown'
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted'
  | 'secret';

export interface AgentInstanceCostBreakdownGroup {
  cache_read: number;
  cache_read_cost: number | null;
  context_limit: number | null;
  input: number;
  input_cost: number | null;
  model_name: string;
  output: number;
  output_cost: number | null;
  provider: string | null;
  total_cost: number | null;
}

export interface AgentInstanceCostBreakdown {
  cache_read: number;
  cache_read_cost: number | null;
  groups: AgentInstanceCostBreakdownGroup[];
  input: number;
  input_cost: number | null;
  output: number;
  output_cost: number | null;
  total_cost: number | null;
}

export interface AgentInstanceRiskScorePerType {
  count: number;
  risk_level: AgentInstanceRiskLevel;
  schema_name: string;
  total_contribution: number;
  type_score: number;
}

export interface AgentInstanceRiskScore {
  all_data_categories: AgentInstanceDataCategory[];
  allowed_actions: AgentInstanceAllowedAction[];
  any_assessable: boolean;
  critical_threshold: number;
  peak_classification: AgentInstanceClassification | null;
  per_type: AgentInstanceRiskScorePerType[];
  risk_level: AgentInstanceRiskLevel | null;
  total_score: number;
}

export interface AgentSpanCounts {
  active: number;
  cancelled: number;
  complete: number;
  failed: number;
  finished: number;
  pending: number;
  total: number;
}

export interface AgentSpanSchemaCounts {
  by_name: Record<string, number>;
}

export interface AgentInstanceAgentContext {
  body: Record<string, unknown>;
  generated_at: string;
  span_count: number;
}

export interface AgentInstanceDetails {
  account_id: string;
  agent_deployment_id: string;
  agent_id: string;
  agent_version_id: string;
  cost_breakdown: AgentInstanceCostBreakdown | null;
  environment_id: string;
  external_identifier: string | null;
  finished_at: string | null;
  id: string;
  inserted_at: string;
  last_activity_span_at: string | null;
  purpose: 'live' | 'smoke_test' | 'eval';
  quality_payloads: Record<string, Record<string, unknown>>;
  quality_summaries: Record<string, string>;
  raised_alert_count: number | null;
  risk_score: AgentInstanceRiskScore | null;
  span_counts: AgentSpanCounts;
  span_schema_counts: AgentSpanSchemaCounts | null;
  started_at: string | null;
  status: 'pending' | 'active' | 'complete' | 'failed' | 'cancelled' | 'terminated';
  termination_reason: string | null;
  type: 'agent_instance';
  updated_at: string;
}

export interface AgentInstanceSummary {
  account_id: string;
  agent_id: string;
  agent_version_id: string;
  environment_id: string;
  external_identifier: string | null;
  finished_at: string | null;
  id: string;
  inserted_at: string;
  last_activity_span_at: string | null;
  purpose: 'live' | 'smoke_test' | 'eval';
  raised_alert_count: number | null;
  risk_score: AgentInstanceRiskScore | null;
  started_at: string | null;
  status: 'pending' | 'active' | 'complete' | 'failed' | 'cancelled' | 'terminated';
  termination_reason: string | null;
  type: 'agent_instance';
  updated_at: string;
}

export type AgentInstanceListResponse = ListResponse<AgentInstanceSummary>;

export interface AgentInstanceShowParams {
  agent_instance_id?: string;
  external_identifier?: string;
  include_counts?: boolean;
  include_costs?: boolean;
  include_risk_score?: boolean;
  include_alert_count?: boolean;
}

export interface AgentInstanceShowResponse {
  details: AgentInstanceDetails;
  status: 'success';
}

export function showAgentInstance(
  client: ApiClient,
  params: AgentInstanceShowParams
): Promise<AgentInstanceShowResponse> {
  return client.request('/agent_instance/show', {
    method: 'GET',
    query: {
      ...(params.agent_instance_id ? { agent_instance_id: params.agent_instance_id } : {}),
      ...(params.external_identifier ? { external_identifier: params.external_identifier } : {}),
      ...(params.include_counts !== undefined ? { include_counts: params.include_counts } : {}),
      ...(params.include_costs !== undefined ? { include_costs: params.include_costs } : {}),
      ...(params.include_risk_score !== undefined
        ? { include_risk_score: params.include_risk_score }
        : {}),
      ...(params.include_alert_count !== undefined
        ? { include_alert_count: params.include_alert_count }
        : {}),
    },
  });
}
