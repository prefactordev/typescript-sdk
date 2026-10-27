import type {
  AgentInstanceFinishOptions,
  AgentInstanceRegisterPayload as AgentInstanceRegistrationPayload,
} from '@prefactor/core';
import { AgentInstanceClient as CoreAgentInstanceClient } from '@prefactor/core';
import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export type {
  AgentInstanceFinishOptions,
  AgentInstanceRegisterPayload as AgentInstanceRegistrationPayload,
  AgentInstanceResponse,
  AgentInstanceTerminateOptions,
} from '@prefactor/core';

export const AGENT_INSTANCE_STATUSES = [
  'preparing',
  'pending',
  'active',
  'complete',
  'failed',
  'cancelled',
  'terminated',
] as const;

export type AgentInstanceStatus = (typeof AGENT_INSTANCE_STATUSES)[number];

/** One instance payload schema: a JSON Schema plus display hints. */
export interface InstancePayloadSchemaForCreate {
  schema: Record<string, unknown>;
  title?: string;
  description?: string;
  template?: string;
}

/** Registration with the instance's input, metadata, and their schemas. */
export type AgentInstancePayloadRegistration = AgentInstanceRegistrationPayload & {
  agent_schema_version?: AgentInstanceRegistrationPayload['agent_schema_version'] & {
    instance_params_payload_schema?: InstancePayloadSchemaForCreate;
    instance_result_payload_schema?: InstancePayloadSchemaForCreate;
    instance_metadata_schema?: InstancePayloadSchemaForCreate;
  };
  params_payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

/** Finish options with the run's result. */
export type AgentInstanceFinishWithResultOptions = AgentInstanceFinishOptions & {
  result_payload?: Record<string, unknown>;
};

export interface AgentInstanceListParams {
  agent_id: string;
  statuses?: AgentInstanceStatus[];
}

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
  metadata: Record<string, unknown> | null;
  params_payload: Record<string, unknown> | null;
  purpose: 'live' | 'smoke_test' | 'eval';
  quality_payloads: Record<string, Record<string, unknown>>;
  result_payload: Record<string, unknown> | null;
  quality_summaries: Record<string, string>;
  raised_alert_count: number | null;
  risk_score: AgentInstanceRiskScore | null;
  span_counts: AgentSpanCounts;
  span_schema_counts: AgentSpanSchemaCounts | null;
  started_at: string | null;
  status: AgentInstanceStatus;
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
  status: AgentInstanceStatus;
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

export class AgentInstanceClient extends CoreAgentInstanceClient {
  constructor(private readonly client: ApiClient) {
    super(client);
  }

  list(params: AgentInstanceListParams): Promise<AgentInstanceListResponse> {
    return this.client.request('/agent_instance', {
      method: 'GET',
      query: {
        agent_id: params.agent_id,
        ...(params.statuses ? { statuses: params.statuses } : {}),
      },
    });
  }

  /** Sets the input of a preparing instance and moves it to pending. */
  prepare(
    agentInstanceId: string,
    paramsPayload: Record<string, unknown>
  ): Promise<AgentInstanceShowResponse> {
    return this.client.request(`/agent_instance/${encodeURIComponent(agentInstanceId)}/prepare`, {
      method: 'POST',
      body: { params_payload: paramsPayload },
    });
  }

  /** Permanently deletes the stored sensitive values in the instance's input, result, and metadata. */
  discardSensitive(agentInstanceId: string): Promise<AgentInstanceShowResponse> {
    return this.client.request(
      `/agent_instance/${encodeURIComponent(agentInstanceId)}/discard_sensitive`,
      { method: 'POST', body: {} }
    );
  }

  judge(agentInstanceId: string, judgeAgentId: string): Promise<AgentInstanceShowResponse> {
    return this.client.request(`/agent_instance/${encodeURIComponent(agentInstanceId)}/judge`, {
      method: 'POST',
      body: { judge_agent_id: judgeAgentId },
    });
  }

  show(params: AgentInstanceShowParams): Promise<AgentInstanceShowResponse> {
    return this.client.request('/agent_instance/show', {
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
}
