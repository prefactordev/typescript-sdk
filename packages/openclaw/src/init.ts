import {
  type Config,
  type CoreRuntime,
  createCore,
  DEFAULT_AGENT_SCHEMA,
  getLogger,
  type Tracer,
} from '@prefactor/core';
import { type PluginConfig, resolveConfig } from './config.js';
import { createInstrumentation } from './instrumentation.js';
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
 *
 * This is the main entry point for the OpenClaw plugin system.
 * It initializes the Prefactor runtime and wires up all the hook handlers.
 */
export function register(api: OpenClawPluginApi): void {
  // Extract config from the plugin entry config
  const pluginConfig =
    (api.config?.plugins?.entries?.['prefactor-openclaw']?.config as PluginConfig) || {};

  const runtime = init(pluginConfig);
  if (!runtime) {
    api.logger?.error('OpenClaw Prefactor plugin disabled due to missing config');
    return;
  }

  const instrumentation = createInstrumentation(runtime.tracer, runtime.config);

  // Wire up all the hook handlers
  api.on('before_agent_start', (event, ctx) => {
    try {
      instrumentation.beforeAgentStart(event, ctx);
    } catch (err) {
      api.logger?.error('Error in before_agent_start hook', err);
    }
  });

  api.on('agent_end', (event, ctx) => {
    try {
      instrumentation.agentEnd(event, ctx);
    } catch (err) {
      api.logger?.error('Error in agent_end hook', err);
    }
  });

  api.on('before_tool_call', (event, ctx) => {
    try {
      instrumentation.beforeToolCall(event, ctx);
    } catch (err) {
      api.logger?.error('Error in before_tool_call hook', err);
    }
  });

  api.on('after_tool_call', (event, ctx) => {
    try {
      instrumentation.afterToolCall(event, ctx);
    } catch (err) {
      api.logger?.error('Error in after_tool_call hook', err);
    }
  });

  api.on('message_received', (event, ctx) => {
    try {
      instrumentation.messageReceived(event, ctx);
    } catch (err) {
      api.logger?.error('Error in message_received hook', err);
    }
  });

  api.on('message_sent', (event, ctx) => {
    try {
      instrumentation.messageSent(event, ctx);
    } catch (err) {
      api.logger?.error('Error in message_sent hook', err);
    }
  });

  api.on('gateway_stop', async () => {
    try {
      await shutdown();
    } catch (err) {
      api.logger?.error('Error in gateway_stop hook', err);
    }
  });

  api.logger?.info('Prefactor observability plugin registered');
}
