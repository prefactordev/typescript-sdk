/**
 * Risk action profile values.
 */
export type ActionProfileValue = 'unknown' | 'allowed' | 'disallowed';

/**
 * Data classification levels, from least to most sensitive.
 */
export type DataClassification =
  | 'unknown'
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted'
  | 'secret';

/**
 * Presence indicator for a data category within a span's params or results.
 */
export type DataCategoryValue = 'unknown' | 'included' | 'excluded';

/**
 * Describes which data-mutating or communicating actions a span type is permitted to perform.
 */
export interface ActionProfile {
  create_data: ActionProfileValue;
  read_data: ActionProfileValue;
  update_data: ActionProfileValue;
  destroy_data: ActionProfileValue;
  financial_transactions: ActionProfileValue;
  external_communication: ActionProfileValue;
}

/**
 * Classifies the sensitivity of data flowing through a span's params or results.
 */
export interface DataCategories {
  classification: DataClassification;
  personal_identifiers: DataCategoryValue;
  contact_information: DataCategoryValue;
  financial_information: DataCategoryValue;
  health_and_medical: DataCategoryValue;
  criminal_justice: DataCategoryValue;
  authentication_and_secrets: DataCategoryValue;
  organisational_confidential: DataCategoryValue;
  minors_data: DataCategoryValue;
  location_and_tracking: DataCategoryValue;
  behavioural_and_inferred: DataCategoryValue;
  gdpr_racial_or_ethnic_origin: DataCategoryValue;
  gdpr_political_opinions: DataCategoryValue;
  gdpr_religious_or_philosophical_beliefs: DataCategoryValue;
  gdpr_trade_union_membership: DataCategoryValue;
  gdpr_genetic_data: DataCategoryValue;
  gdpr_biometric_for_identification: DataCategoryValue;
  gdpr_sex_life_or_sexual_orientation: DataCategoryValue;
}

/**
 * Risk metadata for a span type, describing allowed actions and data categories
 * present in its params and results.
 */
export interface DataRisk {
  action_profile: ActionProfile;
  params_data_categories: DataCategories;
  result_data_categories: DataCategories;
}
