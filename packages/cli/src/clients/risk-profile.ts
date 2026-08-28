import type { ApiClient } from '../api-client.js';
import type { ListResponse } from './list-response.js';

export interface RiskProfileRulesetActionMultipliers {
  create_data: number | null;
  destroy_data: number | null;
  external_communication: number | null;
  financial_transactions: number | null;
  read_data: number | null;
  update_data: number | null;
}

export interface RiskProfileRulesetCategoryWeights {
  authentication_and_secrets: number | null;
  behavioural_and_inferred: number | null;
  contact_information: number | null;
  criminal_justice: number | null;
  financial_information: number | null;
  gdpr_biometric_for_identification: number | null;
  gdpr_genetic_data: number | null;
  gdpr_political_opinions: number | null;
  gdpr_racial_or_ethnic_origin: number | null;
  gdpr_religious_or_philosophical_beliefs: number | null;
  gdpr_sex_life_or_sexual_orientation: number | null;
  gdpr_trade_union_membership: number | null;
  health_and_medical: number | null;
  location_and_tracking: number | null;
  minors_data: number | null;
  organisational_confidential: number | null;
  personal_identifiers: number | null;
}

export interface RiskProfileRulesetThresholds {
  critical: number;
  high: number;
  medium: number;
}

export interface RiskProfileRuleset {
  action_multipliers: RiskProfileRulesetActionMultipliers;
  category_weights: RiskProfileRulesetCategoryWeights;
  thresholds: RiskProfileRulesetThresholds;
}

export interface RiskProfileDetails {
  agreed_data_risk?: Record<string, unknown>;
  description?: string | null;
  id?: string;
  inserted_at?: string;
  name?: string;
  ruleset?: RiskProfileRuleset;
  type?: 'risk_profile';
  updated_at?: string;
}

export interface RiskProfileSummary {
  description?: string | null;
  id?: string;
  name?: string;
  type?: 'risk_profile';
}

export interface RiskProfileForCreate {
  name: string;
  ruleset: RiskProfileRuleset;
  description?: string | null;
  id?: string;
}

export interface RiskProfileForUpdate {
  description?: string | null;
  name?: string;
  ruleset?: RiskProfileRuleset | null;
}

export interface RiskProfileListParams {
  sorting?: string;
  pagination?: {
    offset?: number;
    page_size?: number;
  };
}

export interface RiskProfileResponse {
  details?: RiskProfileDetails;
  status?: 'success';
}

export interface RiskProfileTemplateResponse {
  ruleset?: RiskProfileRuleset;
  status?: 'success';
}

export type RiskProfileListResponse = ListResponse<RiskProfileSummary>;

export class RiskProfileClient {
  constructor(private readonly client: ApiClient) {}

  list(params: RiskProfileListParams = {}): Promise<RiskProfileListResponse> {
    return this.client.request('/risk_profile', {
      method: 'GET',
      query: {
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

  retrieve(id: string): Promise<RiskProfileResponse> {
    return this.client.request(`/risk_profile/${id}`, { method: 'GET' });
  }

  getTemplate(templateName: string): Promise<RiskProfileTemplateResponse> {
    return this.client.request('/risk_profile/template', {
      method: 'GET',
      query: { template_name: templateName },
    });
  }

  create(details: RiskProfileForCreate): Promise<RiskProfileResponse> {
    return this.client.request('/risk_profile', {
      method: 'POST',
      body: { details },
    });
  }

  update(id: string, details: RiskProfileForUpdate): Promise<RiskProfileResponse> {
    return this.client.request(`/risk_profile/${id}`, {
      method: 'PUT',
      body: { details },
    });
  }

  delete(id: string): Promise<RiskProfileResponse> {
    return this.client.request(`/risk_profile/${id}`, { method: 'DELETE' });
  }
}
