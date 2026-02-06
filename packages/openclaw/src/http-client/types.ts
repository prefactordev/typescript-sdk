// Types for Prefactor HTTP Client
// Generated from OpenAPI spec: https://p2demo.prefactor.dev/api/v1/openapi

// Common types
export type AgentId = string;
export type AgentInstanceId = string;
export type AgentSpanId = string;
export type AccountId = string;
export type AgentVersionId = string;
export type EnvironmentId = string;

export type AgentInstanceStatus = 'pending' | 'active' | 'complete' | 'failed' | 'cancelled';
export type AgentSpanStatus = 'pending' | 'active' | 'complete' | 'failed' | 'cancelled';

// AgentVersion types
export interface AgentVersionForRegister {
  description?: string;
  external_identifier: string;
  name: string;
}

export interface AgentSchemaVersionForRegister {
  external_identifier: string;
  span_schemas: Record<string, unknown>;
}

// Span counts
export interface AgentInstanceSpanCounts {
  active: number;
  cancelled: number;
  complete: number;
  failed: number;
  finished: number;
  pending: number;
  total: number;
}

// AgentInstance types
export interface AgentInstanceDetails {
  account_id: AccountId;
  agent_id: AgentId;
  agent_version_id: AgentVersionId;
  environment_id: EnvironmentId;
  finished_at: string | null;
  id: AgentInstanceId;
  inserted_at: string;
  span_counts: AgentInstanceSpanCounts;
  started_at: string | null;
  status: AgentInstanceStatus;
  type: 'agent_instance';
  updated_at: string;
}

// AgentSpan types
export interface AgentSpanDetailsForCreate {
  agent_instance_id: AgentInstanceId;
  schema_name: string;
  status: AgentSpanStatus;
  payload: Record<string, unknown>;
  id?: AgentSpanId | null;
  parent_span_id?: AgentSpanId | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface AgentSpanDetails {
  account_id: AccountId;
  agent_id: AgentId;
  agent_instance_id: AgentInstanceId;
  finished_at: string | null;
  id: AgentSpanId;
  parent_span_id: AgentSpanId | null;
  payload: Record<string, unknown>;
  schema_name: string;
  started_at: string | null;
  status: AgentSpanStatus;
  type: 'agent_span';
}

// Request types
export interface RegisterAgentInstanceRequest {
  agent_id: AgentId;
  id?: AgentInstanceId | null;
  agent_version: AgentVersionForRegister;
  agent_schema_version: AgentSchemaVersionForRegister;
  idempotency_key?: string;
}

export interface StartAgentInstanceRequest {
  timestamp?: string | null;
  idempotency_key?: string;
}

export interface FinishAgentInstanceRequest {
  status?: 'complete' | 'failed' | 'cancelled';
  timestamp?: string | null;
  idempotency_key?: string;
}

export interface CreateAgentSpanRequest {
  details: AgentSpanDetailsForCreate;
  idempotency_key?: string;
}

export interface FinishAgentSpanRequestBody {
  status?: 'complete' | 'failed' | 'cancelled';
  timestamp?: string | null;
}

export interface FinishAgentSpanRequest {
  body?: FinishAgentSpanRequestBody;
  idempotency_key?: string;
}

// Response types
export interface SuccessResponse<T> {
  status: 'success';
  details: T;
}

export interface ErrorResponse {
  status: 'error';
  code: string;
  message: string;
  errors?: Record<string, string[]>;
}

// API response types
export type RegisterAgentInstanceResponse = SuccessResponse<AgentInstanceDetails>;
export type StartAgentInstanceResponse = SuccessResponse<AgentInstanceDetails>;
export type FinishAgentInstanceResponse = SuccessResponse<AgentInstanceDetails>;
export type CreateAgentSpanResponse = SuccessResponse<AgentSpanDetails>;
export type FinishAgentSpanResponse = SuccessResponse<AgentSpanDetails>;
