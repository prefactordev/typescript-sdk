import type { ApiClient } from '../api-client.js';
import type { AgentShowDetails } from './agent.js';
import type { AgentInstanceDetails } from './agent-instance.js';
import type { AgentSchemaVersionSummary } from './agent-schema-version.js';
import type { AgentVersionSummary } from './agent-version.js';

export type PlaygroundScenario = 'good' | 'mixed' | 'bad' | 'timeout' | 'active';

export type PlaygroundInstancePurpose = 'live' | 'smoke_test' | 'eval';

export interface PlaygroundCreateAgentResponse {
  agent: AgentShowDetails;
  status: 'success';
}

export interface PlaygroundCreateFirstAccountAgentParams {
  environment_id?: string;
  seed_instances_and_spans?: boolean;
}

export interface PlaygroundCreateFirstAccountAgentResponse {
  agent: AgentShowDetails;
  agent_instance_ids: string[];
  status: 'success';
}

export interface PlaygroundRecordSpansParams {
  agent_instance_id: string;
}

export interface PlaygroundRecordFirstAccountSpansParams {
  agent_instance_id: string;
  scenario: PlaygroundScenario;
}

export interface PlaygroundRecordSpansResponse {
  ids: string[];
  status: 'success';
}

export interface PlaygroundRegisterInstanceParams {
  agent_id: string;
  environment_id: string;
  id?: string;
}

export interface PlaygroundRegisterFirstAccountInstanceParams {
  agent_id: string;
  environment_id: string;
  scenario: PlaygroundScenario;
  id?: string;
}

export interface PlaygroundRegisterQualityReviewInstanceParams {
  agent_id: string;
  environment_id: string;
  id?: string;
  purpose?: PlaygroundInstancePurpose;
}

export interface PlaygroundRegisterInstanceResponse {
  agent_schema_version: AgentSchemaVersionSummary;
  agent_version: AgentVersionSummary;
  details: AgentInstanceDetails;
  status: 'success';
}

export class PlaygroundClient {
  constructor(private readonly client: ApiClient) {}

  createCustomerSupportAgent(): Promise<PlaygroundCreateAgentResponse> {
    return this.post('create_customer_support_agent', {});
  }

  createFirstAccountAgent(
    params: PlaygroundCreateFirstAccountAgentParams = {}
  ): Promise<PlaygroundCreateFirstAccountAgentResponse> {
    return this.post('create_first_account_agent', {
      ...(params.environment_id ? { environment_id: params.environment_id } : {}),
      ...(params.seed_instances_and_spans !== undefined
        ? { seed_instances_and_spans: params.seed_instances_and_spans }
        : {}),
    });
  }

  createLoanApplicationReviewAgent(): Promise<PlaygroundCreateAgentResponse> {
    return this.post('create_loan_application_review_agent', {});
  }

  createNorthstarSupportAgent(): Promise<PlaygroundCreateAgentResponse> {
    return this.post('create_northstar_support_agent', {});
  }

  createOpenclawAgent(): Promise<PlaygroundCreateAgentResponse> {
    return this.post('create_openclaw_agent', {});
  }

  createQualityReviewAgent(): Promise<PlaygroundCreateAgentResponse> {
    return this.post('create_quality_review_agent', {});
  }

  recordCustomerSupportSpans(
    params: PlaygroundRecordSpansParams
  ): Promise<PlaygroundRecordSpansResponse> {
    return this.post('record_customer_support_spans', params);
  }

  recordFirstAccountSpans(
    params: PlaygroundRecordFirstAccountSpansParams
  ): Promise<PlaygroundRecordSpansResponse> {
    return this.post('record_first_account_spans', params);
  }

  recordLoanApplicationReviewSpans(
    params: PlaygroundRecordSpansParams
  ): Promise<PlaygroundRecordSpansResponse> {
    return this.post('record_loan_application_review_spans', params);
  }

  recordNorthstarSupportSpans(
    params: PlaygroundRecordSpansParams
  ): Promise<PlaygroundRecordSpansResponse> {
    return this.post('record_northstar_support_spans', params);
  }

  recordOpenclawSpans(params: PlaygroundRecordSpansParams): Promise<PlaygroundRecordSpansResponse> {
    return this.post('record_openclaw_spans', params);
  }

  recordQualityReviewSpans(
    params: PlaygroundRecordSpansParams
  ): Promise<PlaygroundRecordSpansResponse> {
    return this.post('record_quality_review_spans', params);
  }

  registerCustomerSupportAgentInstance(
    params: PlaygroundRegisterInstanceParams
  ): Promise<PlaygroundRegisterInstanceResponse> {
    return this.post('register_customer_support_agent_instance', params);
  }

  registerFirstAccountAgentInstance(
    params: PlaygroundRegisterFirstAccountInstanceParams
  ): Promise<PlaygroundRegisterInstanceResponse> {
    return this.post('register_first_account_agent_instance', params);
  }

  registerLoanApplicationReviewAgentInstance(
    params: PlaygroundRegisterInstanceParams
  ): Promise<PlaygroundRegisterInstanceResponse> {
    return this.post('register_loan_application_review_agent_instance', params);
  }

  registerNorthstarSupportAgentInstance(
    params: PlaygroundRegisterInstanceParams
  ): Promise<PlaygroundRegisterInstanceResponse> {
    return this.post('register_northstar_support_agent_instance', params);
  }

  registerOpenclawAgentInstance(
    params: PlaygroundRegisterInstanceParams
  ): Promise<PlaygroundRegisterInstanceResponse> {
    return this.post('register_openclaw_agent_instance', params);
  }

  registerQualityReviewAgentInstance(
    params: PlaygroundRegisterQualityReviewInstanceParams
  ): Promise<PlaygroundRegisterInstanceResponse> {
    return this.post('register_quality_review_agent_instance', params);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.client.request(`/playground/${path}`, {
      method: 'POST',
      body,
    });
  }
}
