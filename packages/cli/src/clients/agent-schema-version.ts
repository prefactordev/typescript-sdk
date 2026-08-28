import type { DataRisk } from '@prefactor/core';
import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface SchemaValidationResult {
  message: string | null;
  status: 'success' | 'error';
}

export interface SchemaDetails {
  data_risk: DataRisk;
  description: string | null;
  name: string;
  schema: Record<string, unknown>;
  schema_validation: SchemaValidationResult;
  template: string | null;
  title: string;
}

export interface SpanTypeSchemaDetails {
  data_risk: DataRisk;
  description: string | null;
  name: string;
  params_schema: Record<string, unknown>;
  params_schema_validation: SchemaValidationResult;
  result_schema: Record<string, unknown>;
  result_schema_validation: SchemaValidationResult;
  template: string | null;
  title: string;
}

export interface AgentSchemaVersion {
  id: string;
  agent_id: string;
  external_identifier: string;
}

export interface AgentSchemaVersionDetails {
  account_id: string;
  agent_id: string;
  alert_schemas: Record<string, SchemaDetails>;
  current_agent_deployment_refs: string[];
  external_identifier: string;
  external_identifier_repeats: number;
  id: string;
  inserted_at: string;
  quality_schemas: Record<string, SchemaDetails>;
  span_type_schemas: Record<string, SpanTypeSchemaDetails>;
  type: 'agent_schema_version';
  updated_at: string;
}

export interface AgentSchemaVersionSummary {
  account_id: string;
  agent_id: string;
  current_agent_deployment_refs: string[];
  external_identifier: string;
  external_identifier_repeats: number;
  id: string;
  inserted_at: string;
  span_schemas_count: number;
  type: 'agent_schema_version';
  updated_at: string;
}

export interface AgentSchemaVersionCreateOptions {
  span_schemas?: Record<string, unknown>;
  span_type_schemas?: unknown[];
  span_result_schemas?: Record<string, unknown>;
}

export interface AgentSchemaVersionResponse {
  details: AgentSchemaVersionDetails;
}

export type AgentSchemaVersionListResponse = ListResponse<AgentSchemaVersionSummary>;

export class AgentSchemaVersionClient {
  constructor(private readonly client: ApiClient) {}

  list(agentId: string): Promise<AgentSchemaVersionListResponse> {
    return this.client.request('/agent_schema_version', {
      method: 'GET',
      query: { agent_id: agentId },
    });
  }

  retrieve(id: string): Promise<AgentSchemaVersionResponse> {
    return this.client.request(`/agent_schema_version/${id}`, { method: 'GET' });
  }

  create(
    agentId: string,
    externalIdentifier: string,
    options: AgentSchemaVersionCreateOptions = {}
  ): Promise<AgentSchemaVersionResponse> {
    return this.client.request('/agent_schema_version', {
      method: 'POST',
      body: {
        details: {
          agent_id: agentId,
          external_identifier: externalIdentifier,
          ...options,
        },
      },
    });
  }
}
