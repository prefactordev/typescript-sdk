/**
 * Prefactor Extension Configuration
 * 
 * Supports both environment variables and package configuration.
 * Priority: package config > environment variables > defaults
 * 
 * @module
 */

import { z } from 'zod';

/**
 * Prefactor extension configuration schema.
 * All fields are validated with Zod for type safety.
 */
export const configSchema = z.object({
  // Required - Prefactor API credentials
  apiUrl: z.string().url().default('https://app.prefactorai.com').describe('Prefactor API URL (e.g., https://app.prefactorai.com)'),
  apiToken: z.string().min(1).describe('Prefactor API token for authentication'),
  agentId: z.string().min(1).describe('Agent ID registered in Prefactor'),
  
  // Optional - Agent identification
  agentName: z.string().default('Pi Agent').describe('Human-readable agent name shown in Prefactor UI'),
  agentVersion: z.string().default('default').describe('Agent version suffix for tracking deployments'),
  
  // Optional - Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info').describe('Logging verbosity level'),
  
  // Optional - Timeouts
  userInteractionTimeoutMinutes: z.number().positive().default(5)
    .describe('Timeout for user interaction spans (minutes)'),
  sessionTimeoutHours: z.number().positive().default(24)
    .describe('Timeout for session spans (hours)'),
  
  // Optional - Payload limits
  maxInputLength: z.number().positive().default(10000)
    .describe('Maximum input payload length to capture (characters)'),
  maxOutputLength: z.number().positive().default(10000)
    .describe('Maximum output payload length to capture (characters)'),
});

/**
 * Prefactor configuration type (inferred from schema).
 */
export type PrefactorConfig = z.infer<typeof configSchema>;

/**
 * Load configuration from environment variables and/or package config.
 * 
 * Priority order:
 * 1. Package config (from settings.json packages[].config)
 * 2. Environment variables
 * 3. Default values
 * 
 * @param packageConfig - Optional configuration from pi package system
 * @returns Validated configuration object
 * 
 * @example
 * ```typescript
 * // In extension entry point
 * const packageConfig = pi.getPackageConfig?.('pi-prefactor') ?? {};
 * const config = loadConfig(packageConfig);
 * ```
 */
export function loadConfig(packageConfig?: Record<string, unknown>): PrefactorConfig {
  const merged = {
    // Required fields (apiUrl has default)
    apiUrl: packageConfig?.apiUrl ?? process.env.PREFACTOR_API_URL ?? 'https://app.prefactorai.com',
    apiToken: packageConfig?.apiToken ?? process.env.PREFACTOR_API_TOKEN,
    agentId: packageConfig?.agentId ?? process.env.PREFACTOR_AGENT_ID,
    
    // Agent identification
    agentName: packageConfig?.agentName ?? process.env.PREFACTOR_AGENT_NAME ?? 'Pi Agent',
    agentVersion: packageConfig?.agentVersion ?? process.env.PREFACTOR_AGENT_VERSION ?? 'default',
    
    // Logging
    logLevel: packageConfig?.logLevel ?? process.env.PREFACTOR_LOG_LEVEL ?? 'info',
    
    // Timeouts (parse from string env vars)
    userInteractionTimeoutMinutes: 
      packageConfig?.userInteractionTimeoutMinutes ?? 
      (process.env.PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES 
        ? parseInt(process.env.PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES, 10) 
        : 5),
    sessionTimeoutHours: 
      packageConfig?.sessionTimeoutHours ?? 
      (process.env.PREFACTOR_SESSION_TIMEOUT_HOURS 
        ? parseInt(process.env.PREFACTOR_SESSION_TIMEOUT_HOURS, 10) 
        : 24),
    
    // Payload limits
    maxInputLength: packageConfig?.maxInputLength ?? 
      (process.env.PREFACTOR_MAX_INPUT_LENGTH 
        ? parseInt(process.env.PREFACTOR_MAX_INPUT_LENGTH, 10) 
        : 10000),
    maxOutputLength: packageConfig?.maxOutputLength ?? 
      (process.env.PREFACTOR_MAX_OUTPUT_LENGTH 
        ? parseInt(process.env.PREFACTOR_MAX_OUTPUT_LENGTH, 10) 
        : 10000),
  };

  return configSchema.parse(merged);
}

/**
 * Validate that required configuration is present.
 * 
 * @param config - Configuration object to validate
 * @returns Validation result with error details if invalid
 * 
 * @example
 * ```typescript
 * const validation = validateConfig(config);
 * if (!validation.ok) {
 *   console.error('Configuration error:', validation.error);
 *   console.error('Missing:', validation.missing?.join(', '));
 * }
 * ```
 */
export function validateConfig(config: PrefactorConfig): { 
  ok: boolean; 
  error?: string;
  missing?: string[];
} {
  const missing: string[] = [];
  
  if (!config.apiToken) missing.push('PREFACTOR_API_TOKEN');
  if (!config.agentId) missing.push('PREFACTOR_AGENT_ID');
  
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required configuration: ${missing.join(', ')}`,
      missing,
    };
  }
  
  return { ok: true };
}

/**
 * Get configuration summary for logging/debugging.
 * Hides sensitive values (apiToken) for security.
 * 
 * @param config - Configuration object
 * @returns Safe-to-log summary object
 * 
 * @example
 * ```typescript
 * logger.info('config_loaded', getConfigSummary(config));
 * // Output: { apiUrl: 'https://...', agentId: '...', apiToken: '***xyz' }
 * ```
 */
export function getConfigSummary(config: PrefactorConfig): Record<string, unknown> {
  return {
    // Identity
    apiUrl: config.apiUrl,
    agentId: config.agentId,
    agentName: config.agentName,
    agentVersion: config.agentVersion,
    
    // Settings
    logLevel: config.logLevel,
    userInteractionTimeoutMinutes: config.userInteractionTimeoutMinutes,
    sessionTimeoutHours: config.sessionTimeoutHours,
    
    // Capture flags
    captureThinking: config.captureThinking,
    captureToolInputs: config.captureToolInputs,
    captureToolOutputs: config.captureToolOutputs,
    
    // Payload limits
    maxInputLength: config.maxInputLength,
    maxOutputLength: config.maxOutputLength,
    
    // Token (masked for security)
    apiToken: config.apiToken ? '***' + config.apiToken.slice(-4) : undefined,
  };
}

/**
 * Create a configuration error message for user display.
 * 
 * @param validation - Validation result from validateConfig()
 * @returns Formatted error message with setup instructions
 */
export function getConfigErrorMessage(validation: ReturnType<typeof validateConfig>): string {
  if (validation.ok) {
    return '';
  }
  
  let msg = `Prefactor Extension Configuration Error\n\n`;
  msg += `Missing required configuration:\n`;
  
  if (validation.missing) {
    for (const field of validation.missing) {
      msg += `  - ${field}\n`;
    }
  }
  
  msg += `\nSet environment variables:\n`;
  msg += `  export PREFACTOR_API_TOKEN=your-token\n`;
  msg += `  export PREFACTOR_AGENT_ID=your-agent-id\n`;
  msg += `  # Optional: PREFACTOR_API_URL defaults to https://app.prefactorai.com\n`;
  msg += `\nOr configure in settings.json:\n`;
  msg += `  {\n`;
  msg += `    "packages": [{\n`;
  msg += `      "id": "pi-prefactor",\n`;
  msg += `      "config": {\n`;
  msg += `        "apiToken": "...",\n`;
  msg += `        "agentId": "..."\n`;
  msg += `        # apiUrl optional, defaults to https://app.prefactorai.com\n`;
  msg += `      }\n`;
  msg += `    }]\n`;
  msg += `  }\n`;
  
  return msg;
}
