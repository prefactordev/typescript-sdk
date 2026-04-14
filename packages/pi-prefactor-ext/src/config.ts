/**
 * Prefactor Extension Configuration
 *
 * Loads configuration from environment variables with PREFACTOR_ prefix.
 * All fields are validated with Zod for type safety.
 *
 * @module
 */

import { z } from 'zod';

/**
 * Configuration schema for Prefactor Extension.
 * API credentials (apiToken, agentId) are optional to allow graceful
 * degradation when Prefactor is not configured. Use `isConfigured`
 * on the returned config to check availability.
 */
export const configSchema = z.object({
  // API credentials (optional — extension degrades gracefully when missing)
  apiUrl: z.string().url().default('https://app.prefactorai.com').describe('Prefactor API URL'),
  apiToken: z.string().min(1).optional().describe('Prefactor API token for authentication'),
  agentId: z.string().min(1).optional().describe('Agent ID registered in Prefactor'),

  // Optional - Logging
  logLevel: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('error')
    .describe('Logging verbosity level (only effective when PREFACTOR_LOG_LEVEL env var is set)'),

  // Optional - Capture flags
  captureInputs: z.boolean().default(true).describe('Whether to capture LLM inputs'),
  captureOutputs: z.boolean().default(true).describe('Whether to capture LLM outputs'),

  // Optional - Payload limits
  maxOutputLength: z
    .number()
    .positive()
    .default(10000)
    .describe('Maximum output length to capture (characters)'),
});

/**
 * Configuration type inferred from schema.
 */
export type Config = z.infer<typeof configSchema> & { isConfigured: boolean };

/**
 * Load configuration from environment variables.
 *
 * This function never throws. When Prefactor credentials are missing,
 * the returned config has `isConfigured: false` and `apiToken`/`agentId`
 * set to `undefined`. The extension uses this to degrade gracefully
 * (show a TUI notification instead of crashing).
 *
 * Environment variables:
 * - PREFACTOR_API_URL (optional, defaults to https://app.prefactorai.com)
 * - PREFACTOR_API_TOKEN (required for telemetry)
 * - PREFACTOR_AGENT_ID (required for telemetry)
 * - PREFACTOR_LOG_LEVEL (optional, defaults to 'error')
 * - PREFACTOR_CAPTURE_INPUTS (optional, defaults to 'true')
 * - PREFACTOR_CAPTURE_OUTPUTS (optional, defaults to 'true')
 * - PREFACTOR_MAX_OUTPUT_LENGTH (optional, defaults to '10000')
 *
 * @returns Validated configuration object with `isConfigured` flag
 */
export function loadConfig(): Config {
  const merged = {
    apiUrl: process.env.PREFACTOR_API_URL ?? 'https://app.prefactorai.com',
    apiToken: process.env.PREFACTOR_API_TOKEN || undefined,
    agentId: process.env.PREFACTOR_AGENT_ID || undefined,
    logLevel: process.env.PREFACTOR_LOG_LEVEL ?? 'error',
    captureInputs: process.env.PREFACTOR_CAPTURE_INPUTS !== 'false',
    captureOutputs: process.env.PREFACTOR_CAPTURE_OUTPUTS !== 'false',
    maxOutputLength: process.env.PREFACTOR_MAX_OUTPUT_LENGTH
      ? parseInt(process.env.PREFACTOR_MAX_OUTPUT_LENGTH, 10)
      : 10000,
  };

  const parsed = configSchema.safeParse(merged);

  if (!parsed.success) {
    // Return a minimal config that marks the extension as not configured.
    // This prevents ZodError from crashing the extension / pi.
    return {
      apiUrl: 'https://app.prefactorai.com',
      apiToken: undefined,
      agentId: undefined,
      logLevel: 'error',
      captureInputs: true,
      captureOutputs: true,
      maxOutputLength: 10000,
      isConfigured: false,
    };
  }

  const data = parsed.data;
  const isConfigured = !!(data.apiToken && data.agentId);

  return { ...data, isConfigured };
}

/**
 * Validate that required configuration is present.
 *
 * When credentials are missing, returns `{ ok: false, ... }` with details
 * about what's missing — but the caller should use this to decide whether
 * to send telemetry, NOT to crash the extension.
 *
 * @param config - Configuration object to validate
 * @returns Validation result with error details if invalid
 */
export function validateConfig(config: Config): {
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
 * Get the list of missing credential env var names.
 *
 * @param config - Configuration object
 * @returns Array of missing env var names (empty if fully configured)
 */
export function getMissingCredentials(config: Config): string[] {
  const missing: string[] = [];
  if (!config.apiToken) missing.push('PREFACTOR_API_TOKEN');
  if (!config.agentId) missing.push('PREFACTOR_AGENT_ID');
  return missing;
}

/**
 * Get configuration summary for logging (hides sensitive values).
 *
 * @param config - Configuration object
 * @returns Safe-to-log summary object
 */
export function getConfigSummary(config: Config): Record<string, unknown> {
  return {
    apiUrl: config.apiUrl,
    agentId: config.agentId ?? '(not set)',
    isConfigured: config.isConfigured,
    logLevel: config.logLevel,
    captureInputs: config.captureInputs,
    captureOutputs: config.captureOutputs,
    maxOutputLength: config.maxOutputLength,
    apiToken: config.apiToken ? `***${config.apiToken.slice(-4)}` : '(not set)',
  };
}
