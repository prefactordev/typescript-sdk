/**
 * Data risk configuration for OpenClaw span types.
 *
 * Defines default risk profiles for each span type based on the operations they perform
 * and the categories of sensitive data they may handle. These profiles are used for
 * compliance tracking and data governance.
 *
 * @module @prefactor/openclaw-prefactor-plugin/data-risk
 */

import type { DataRisk } from '@prefactor/core';

/**
 * Helper to create a DataCategories object with all fields set to a specific value.
 * Useful for creating consistent category sets.
 */
function createDataCategories(
  classification: DataRisk['params_data_categories']['classification'],
  value: 'unknown' | 'included' | 'excluded' = 'unknown'
): DataRisk['params_data_categories'] {
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

/**
 * Default risk profile for openclaw:user_message span.
 * User messages may contain any type of data including organizational confidential information.
 */
export const userMessageRisk: DataRisk = {
  action_profile: {
    create_data: 'unknown',
    read_data: 'unknown',
    update_data: 'unknown',
    destroy_data: 'unknown',
    financial_transactions: 'disallowed',
    external_communication: 'unknown',
  },
  params_data_categories: createDataCategories('confidential', 'unknown'),
  result_data_categories: createDataCategories('confidential', 'unknown'),
};

/**
 * Default risk profile for openclaw:agent_run span.
 * Agent runs orchestrate operations but don't directly handle data mutations.
 */
export const agentRunRisk: DataRisk = {
  action_profile: {
    create_data: 'unknown',
    read_data: 'unknown',
    update_data: 'unknown',
    destroy_data: 'unknown',
    financial_transactions: 'disallowed',
    external_communication: 'unknown',
  },
  params_data_categories: createDataCategories('internal', 'unknown'),
  result_data_categories: createDataCategories('internal', 'unknown'),
};

/**
 * Default risk profile for openclaw:agent_thinking span.
 * Thinking spans contain reasoning that may reference organizational confidential data.
 */
export const agentThinkingRisk: DataRisk = {
  action_profile: {
    create_data: 'allowed',
    read_data: 'unknown',
    update_data: 'unknown',
    destroy_data: 'unknown',
    financial_transactions: 'disallowed',
    external_communication: 'unknown',
  },
  params_data_categories: createDataCategories('confidential', 'unknown'),
  result_data_categories: createDataCategories('confidential', 'unknown'),
};

/**
 * Default risk profile for openclaw:assistant_response span.
 * Assistant responses may contain organizational confidential information from context.
 */
export const assistantResponseRisk: DataRisk = {
  action_profile: {
    create_data: 'allowed',
    read_data: 'unknown',
    update_data: 'unknown',
    destroy_data: 'unknown',
    financial_transactions: 'disallowed',
    external_communication: 'unknown',
  },
  params_data_categories: createDataCategories('confidential', 'unknown'),
  result_data_categories: createDataCategories('internal', 'unknown'),
};

/**
 * Default risk profile for openclaw:session span.
 * Session spans track lifecycle but contain minimal data.
 */
export const sessionRisk: DataRisk = {
  action_profile: {
    create_data: 'allowed',
    read_data: 'unknown',
    update_data: 'unknown',
    destroy_data: 'unknown',
    financial_transactions: 'disallowed',
    external_communication: 'unknown',
  },
  params_data_categories: createDataCategories('internal', 'unknown'),
  result_data_categories: createDataCategories('internal', 'unknown'),
};

/**
 * Default risk profile for openclaw:user_interaction span.
 * User interactions may involve organizational confidential data.
 */
export const userInteractionRisk: DataRisk = {
  action_profile: {
    create_data: 'unknown',
    read_data: 'unknown',
    update_data: 'unknown',
    destroy_data: 'unknown',
    financial_transactions: 'disallowed',
    external_communication: 'unknown',
  },
  params_data_categories: createDataCategories('confidential', 'unknown'),
  result_data_categories: createDataCategories('confidential', 'unknown'),
};

/**
 * Default risk profile for openclaw:tool span (generic fallback).
 * Generic tool calls have unknown risk until specific tool is identified.
 */
export const toolRisk: DataRisk = {
  action_profile: {
    create_data: 'unknown',
    read_data: 'unknown',
    update_data: 'unknown',
    destroy_data: 'unknown',
    financial_transactions: 'disallowed',
    external_communication: 'unknown',
  },
  params_data_categories: createDataCategories('unknown', 'unknown'),
  result_data_categories: createDataCategories('unknown', 'unknown'),
};

/**
 * Default risk profile for openclaw:tool:read span.
 * Read operations access filesystem data which may include organizational confidential info and secrets.
 */
export const toolReadRisk: DataRisk = {
  action_profile: {
    create_data: 'disallowed',
    read_data: 'allowed',
    update_data: 'disallowed',
    destroy_data: 'disallowed',
    financial_transactions: 'disallowed',
    external_communication: 'disallowed',
  },
  params_data_categories: {
    ...createDataCategories('confidential', 'excluded'),
    authentication_and_secrets: 'included',
    organisational_confidential: 'included',
  },
  result_data_categories: {
    ...createDataCategories('confidential', 'excluded'),
    authentication_and_secrets: 'included',
    organisational_confidential: 'included',
  },
};

/**
 * Default risk profile for openclaw:tool:write span.
 * Write operations create data which may include organizational confidential info.
 */
export const toolWriteRisk: DataRisk = {
  action_profile: {
    create_data: 'allowed',
    read_data: 'disallowed',
    update_data: 'disallowed',
    destroy_data: 'disallowed',
    financial_transactions: 'disallowed',
    external_communication: 'disallowed',
  },
  params_data_categories: {
    ...createDataCategories('confidential', 'excluded'),
    authentication_and_secrets: 'unknown',
    organisational_confidential: 'included',
  },
  result_data_categories: {
    ...createDataCategories('confidential', 'excluded'),
    authentication_and_secrets: 'unknown',
    organisational_confidential: 'included',
  },
};

/**
 * Default risk profile for openclaw:tool:edit span.
 * Edit operations modify data which may include organizational confidential info and secrets.
 */
export const toolEditRisk: DataRisk = {
  action_profile: {
    create_data: 'disallowed',
    read_data: 'disallowed',
    update_data: 'allowed',
    destroy_data: 'disallowed',
    financial_transactions: 'disallowed',
    external_communication: 'disallowed',
  },
  params_data_categories: {
    ...createDataCategories('confidential', 'excluded'),
    authentication_and_secrets: 'included',
    organisational_confidential: 'included',
  },
  result_data_categories: {
    ...createDataCategories('confidential', 'excluded'),
    authentication_and_secrets: 'included',
    organisational_confidential: 'included',
  },
};

/**
 * Default risk profile for openclaw:tool:exec span.
 * Shell execution is high-risk - can access secrets and execute arbitrary commands.
 */
export const toolExecRisk: DataRisk = {
  action_profile: {
    create_data: 'unknown',
    read_data: 'allowed',
    update_data: 'unknown',
    destroy_data: 'unknown',
    financial_transactions: 'disallowed',
    external_communication: 'disallowed',
  },
  params_data_categories: {
    ...createDataCategories('restricted', 'excluded'),
    authentication_and_secrets: 'included',
    organisational_confidential: 'included',
  },
  result_data_categories: {
    ...createDataCategories('restricted', 'excluded'),
    authentication_and_secrets: 'included',
    organisational_confidential: 'included',
  },
};

/**
 * Default risk profile for openclaw:tool:web_search span.
 * Web search sends queries to external services but doesn't typically include sensitive data.
 */
export const toolWebSearchRisk: DataRisk = {
  action_profile: {
    create_data: 'disallowed',
    read_data: 'disallowed',
    update_data: 'disallowed',
    destroy_data: 'disallowed',
    financial_transactions: 'disallowed',
    external_communication: 'allowed',
  },
  params_data_categories: createDataCategories('public', 'excluded'),
  result_data_categories: createDataCategories('public', 'excluded'),
};

/**
 * Default risk profile for openclaw:tool:web_fetch span.
 * Web fetch retrieves public content from external URLs.
 */
export const toolWebFetchRisk: DataRisk = {
  action_profile: {
    create_data: 'disallowed',
    read_data: 'disallowed',
    update_data: 'disallowed',
    destroy_data: 'disallowed',
    financial_transactions: 'disallowed',
    external_communication: 'allowed',
  },
  params_data_categories: createDataCategories('public', 'excluded'),
  result_data_categories: createDataCategories('public', 'excluded'),
};

/**
 * Default risk profile for openclaw:tool:browser span.
 * Browser automation interacts with external web services.
 */
export const toolBrowserRisk: DataRisk = {
  action_profile: {
    create_data: 'disallowed',
    read_data: 'disallowed',
    update_data: 'disallowed',
    destroy_data: 'disallowed',
    financial_transactions: 'disallowed',
    external_communication: 'allowed',
  },
  params_data_categories: createDataCategories('public', 'excluded'),
  result_data_categories: createDataCategories('public', 'excluded'),
};

/**
 * Complete default risk configuration for all OpenClaw span types.
 * This configuration is used when registering the agent schema version.
 */
export const defaultSpanTypeRiskConfigs: Record<string, DataRisk> = {
  'openclaw:user_message': userMessageRisk,
  'openclaw:agent_run': agentRunRisk,
  'openclaw:agent_thinking': agentThinkingRisk,
  'openclaw:assistant_response': assistantResponseRisk,
  'openclaw:session': sessionRisk,
  'openclaw:user_interaction': userInteractionRisk,
  'openclaw:tool': toolRisk,
  'openclaw:tool:read': toolReadRisk,
  'openclaw:tool:write': toolWriteRisk,
  'openclaw:tool:edit': toolEditRisk,
  'openclaw:tool:exec': toolExecRisk,
  'openclaw:tool:web_search': toolWebSearchRisk,
  'openclaw:tool:web_fetch': toolWebFetchRisk,
  'openclaw:tool:browser': toolBrowserRisk,
};

/**
 * Creates a merged risk configuration by combining default configs with user-provided overrides.
 * User overrides take precedence over defaults.
 *
 * @param userConfigs - User-provided risk configurations to merge with defaults
 * @returns Merged risk configuration
 */
export function createRiskConfig(userConfigs?: Record<string, DataRisk>): Record<string, DataRisk> {
  if (!userConfigs) {
    return { ...defaultSpanTypeRiskConfigs };
  }

  return {
    ...defaultSpanTypeRiskConfigs,
    ...userConfigs,
  };
}
