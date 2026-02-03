import {
  type Config,
  type CoreRuntime,
  type Tracer,
  DEFAULT_AGENT_SCHEMA,
  createCore,
  getLogger,
} from '@prefactor/core';
import { resolveConfig, type PluginConfig } from './config.js';
import type { OpenClawPluginApi } from './types.js';

const logger = getLogger('openclaw');

type OpenClawRuntime = CoreRuntime & { config: Config };

let runtime: OpenClawRuntime | null = null;

export type InitResult = OpenClawRuntime | null;

/**
 * Initialize the Prefactor plugin for OpenClaw.
 * Returns null if configuration is invalid.
 */
export function init(config?: PluginConfig): InitResult {
  if (runtime) {
    return runtime;
  }

  const resolved = resolveConfig(config);
  if (!resolved) {
    logger.error('OpenClaw Prefactor plugin: missing HTTP credentials');
    return null;
  }

  const core = createCore(resolved);
  runtime = { ...core, config: resolved };

  const httpConfig = resolved.httpConfig;
  if (httpConfig?.agentSchema) {
    runtime.agentManager.registerSchema(httpConfig.agentSchema);
  } else if (
    resolved.transportType === 'http' &&
    (httpConfig?.agentSchemaIdentifier || httpConfig?.skipSchema)
  ) {
    logger.debug('Skipping default schema registration based on httpConfig');
  } else {
    runtime.agentManager.registerSchema(DEFAULT_AGENT_SCHEMA);
  }

  return runtime;
}

/**
 * Get the current tracer instance.
 */
export function getTracer(): Tracer | null {
  return runtime?.tracer ?? null;
}

/**
 * Shutdown the plugin and flush any pending spans.
 */
export async function shutdown(): Promise<void> {
  if (!runtime) return;
  await runtime.shutdown();
  runtime = null;
}

/**
 * Register the plugin with OpenClaw.
 * Note: This is a placeholder for Task 7.
 */
export function register(api: OpenClawPluginApi): void {
  // Will be implemented in Task 7
}
