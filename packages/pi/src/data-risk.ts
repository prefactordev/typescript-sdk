import type {
  DataCategories,
  DataCategoryValue,
  DataClassification,
  DataRisk,
} from '@prefactor/core';

function createDataCategories(
  classification: DataClassification,
  value: DataCategoryValue
): DataCategories {
  return {
    classification,
    personal_identifiers: value,
    contact_information: value,
    financial_information: value,
    health_and_medical: value,
    criminal_justice: value,
    authentication_and_secrets: value,
    organisational_confidential: value,
    minors_data: value,
    location_and_tracking: value,
    behavioural_and_inferred: value,
    gdpr_racial_or_ethnic_origin: value,
    gdpr_political_opinions: value,
    gdpr_religious_or_philosophical_beliefs: value,
    gdpr_trade_union_membership: value,
    gdpr_genetic_data: value,
    gdpr_biometric_for_identification: value,
    gdpr_sex_life_or_sexual_orientation: value,
  };
}

const UNKNOWN_ACTIONS = {
  create_data: 'unknown',
  read_data: 'unknown',
  update_data: 'unknown',
  destroy_data: 'unknown',
  financial_transactions: 'disallowed',
  external_communication: 'unknown',
} as const;

const FILE_DATA_CATEGORIES: DataCategories = {
  ...createDataCategories('confidential', 'excluded'),
  authentication_and_secrets: 'included',
  organisational_confidential: 'included',
};

const SHELL_DATA_CATEGORIES: DataCategories = {
  ...createDataCategories('restricted', 'excluded'),
  authentication_and_secrets: 'included',
  organisational_confidential: 'included',
};

/**
 * Default data risk settings for each pi span type, taken from the OpenClaw plugin's defaults:
 * session from its session span, agent run from its user message span (the run holds the prompt),
 * LLM from its assistant response span, and tools from its tool spans, with `bash` as `exec`.
 */
export const DEFAULT_SPAN_TYPE_RISK: Record<string, DataRisk> = {
  'pi:session': {
    action_profile: { ...UNKNOWN_ACTIONS, create_data: 'allowed' },
    params_data_categories: createDataCategories('internal', 'unknown'),
    result_data_categories: createDataCategories('internal', 'unknown'),
  },
  'pi:agent_run': {
    action_profile: UNKNOWN_ACTIONS,
    params_data_categories: createDataCategories('confidential', 'unknown'),
    result_data_categories: createDataCategories('confidential', 'unknown'),
  },
  'pi:llm': {
    action_profile: { ...UNKNOWN_ACTIONS, create_data: 'allowed' },
    params_data_categories: createDataCategories('confidential', 'unknown'),
    result_data_categories: createDataCategories('internal', 'unknown'),
  },
  'pi:tool': {
    action_profile: UNKNOWN_ACTIONS,
    params_data_categories: createDataCategories('unknown', 'unknown'),
    result_data_categories: createDataCategories('unknown', 'unknown'),
  },
  'pi:tool:read': {
    action_profile: {
      create_data: 'disallowed',
      read_data: 'allowed',
      update_data: 'disallowed',
      destroy_data: 'disallowed',
      financial_transactions: 'disallowed',
      external_communication: 'disallowed',
    },
    params_data_categories: FILE_DATA_CATEGORIES,
    result_data_categories: FILE_DATA_CATEGORIES,
  },
  'pi:tool:write': {
    action_profile: {
      create_data: 'allowed',
      read_data: 'disallowed',
      update_data: 'disallowed',
      destroy_data: 'disallowed',
      financial_transactions: 'disallowed',
      external_communication: 'disallowed',
    },
    params_data_categories: { ...FILE_DATA_CATEGORIES, authentication_and_secrets: 'unknown' },
    result_data_categories: { ...FILE_DATA_CATEGORIES, authentication_and_secrets: 'unknown' },
  },
  'pi:tool:edit': {
    action_profile: {
      create_data: 'disallowed',
      read_data: 'disallowed',
      update_data: 'allowed',
      destroy_data: 'disallowed',
      financial_transactions: 'disallowed',
      external_communication: 'disallowed',
    },
    params_data_categories: FILE_DATA_CATEGORIES,
    result_data_categories: FILE_DATA_CATEGORIES,
  },
  'pi:tool:bash': {
    action_profile: {
      create_data: 'unknown',
      read_data: 'allowed',
      update_data: 'unknown',
      destroy_data: 'unknown',
      financial_transactions: 'disallowed',
      external_communication: 'disallowed',
    },
    params_data_categories: SHELL_DATA_CATEGORIES,
    result_data_categories: SHELL_DATA_CATEGORIES,
  },
};
