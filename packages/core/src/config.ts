import { z } from 'zod';

/**
 * Configuration schema for HTTP transport
 */
export const HttpTransportConfigSchema = z.object({
  /** API endpoint URL */
  apiUrl: z.string().url(),

  /** Authentication token */
  apiToken: z.string().min(1),

  /** Optional agent instance identifier (internal ID) */
  agentId: z.string().optional(),

  /** Optional agent identifier (external identifier; formerly agentVersion) */
  agentVersion: z.string().optional(),

  /** Optional agent name */
  agentName: z.string().optional(),

  /** Optional agent description */
  agentDescription: z.string().optional(),

  /** Optional schema identifier name (used for registration/agent instance) */
  schemaName: z.string().optional(),

  /** Optional schema identifier version (used for registration/agent instance) */
  schemaVersion: z.string().optional(),

  /** Optional agent schema for validation (full schema object) */
  agentSchema: z.record(z.unknown()).optional(),

  /** Optional pre-registered schema identifier (external identifier string) */
  agentSchemaVersion: z.string().optional(),

  /** Skip schema validation */
  skipSchema: z.boolean().default(false),

  /** Request timeout in milliseconds */
  requestTimeout: z.number().positive().default(30000),

  /** Connection timeout in milliseconds */
  connectTimeout: z.number().positive().default(10000),

  /** Maximum number of retry attempts */
  maxRetries: z.number().int().nonnegative().default(3),

  /** Initial delay between retries in milliseconds */
  initialRetryDelay: z.number().positive().default(1000),

  /** Maximum delay between retries in milliseconds */
  maxRetryDelay: z.number().positive().default(60000),

  /** Multiplier for exponential backoff */
  retryMultiplier: z.number().positive().default(2.0),
});

export type HttpTransportConfig = z.infer<typeof HttpTransportConfigSchema>;

/**
 * Partial HTTP config schema for user input (before defaults are applied)
 */
export const PartialHttpConfigSchema = z.object({
  apiUrl: z.string().url(),
  apiToken: z.string().min(1),
  agentId: z.string().optional(),
  agentVersion: z.string().optional(),
  agentName: z.string().optional(),
  agentDescription: z.string().optional(),
  schemaName: z.string().optional(),
  schemaVersion: z.string().optional(),
  agentSchema: z.record(z.unknown()).optional(),
  agentSchemaVersion: z.string().optional(),
  skipSchema: z.boolean().optional(),
  requestTimeout: z.number().positive().optional(),
  connectTimeout: z.number().positive().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  initialRetryDelay: z.number().positive().optional(),
  maxRetryDelay: z.number().positive().optional(),
  retryMultiplier: z.number().positive().optional(),
});

export type PartialHttpConfig = z.infer<typeof PartialHttpConfigSchema>;

/**
 * Main SDK configuration schema
 */
export const ConfigSchema = z.object({
  /** Transport type to use for span emission */
  transportType: z.enum(['stdio', 'http']).default('stdio'),

  /** Sampling rate (0.0 to 1.0) */
  sampleRate: z.number().min(0).max(1).default(1.0),

  /** Whether to capture span inputs */
  captureInputs: z.boolean().default(true),

  /** Whether to capture span outputs */
  captureOutputs: z.boolean().default(true),

  /** Maximum length for input strings */
  maxInputLength: z.number().int().positive().default(10000),

  /** Maximum length for output strings */
  maxOutputLength: z.number().int().positive().default(10000),

  /** HTTP transport configuration (required if transportType is 'http') */
  httpConfig: PartialHttpConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Creates a validated configuration object by merging provided options with
 * environment variables and defaults.
 *
 * @param options - Partial configuration options
 * @returns Validated configuration object
 * @throws {z.ZodError} If configuration is invalid
 *
 * @example
 * ```typescript
 * const config = createConfig({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *   }
 * });
 * ```
 */
export function createConfig(options?: Partial<Config>): Config {
  const config = {
    transportType:
      options?.transportType ??
      (process.env.PREFACTOR_TRANSPORT as 'stdio' | 'http' | undefined) ??
      'stdio',
    sampleRate: options?.sampleRate ?? parseFloat(process.env.PREFACTOR_SAMPLE_RATE ?? '1.0'),
    captureInputs: options?.captureInputs ?? process.env.PREFACTOR_CAPTURE_INPUTS !== 'false',
    captureOutputs: options?.captureOutputs ?? process.env.PREFACTOR_CAPTURE_OUTPUTS !== 'false',
    maxInputLength:
      options?.maxInputLength ?? parseInt(process.env.PREFACTOR_MAX_INPUT_LENGTH ?? '10000', 10),
    maxOutputLength:
      options?.maxOutputLength ?? parseInt(process.env.PREFACTOR_MAX_OUTPUT_LENGTH ?? '10000', 10),
    httpConfig: options?.httpConfig,
  };

  // Validate and return
  return ConfigSchema.parse(config);
}
