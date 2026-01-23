/**
 * @fileoverview Initialization module for AI SDK telemetry with Prefactor.
 *
 * This module provides the main entry points for configuring and managing
 * the telemetry tracer for use with Vercel AI SDK's experimental_telemetry feature,
 * sending data to the Prefactor platform.
 *
 * @module init
 * @packageDocumentation
 */

import {
  type Config,
  configureLogging,
  createConfig,
  getLogger,
  HttpTransport,
  HttpTransportConfigSchema,
  StdioTransport,
  Tracer,
  type Transport,
} from '@prefactor/core';
import { extractPartition, type Partition } from '@prefactor/pfid';
import { AiTracerAdapter } from './adapter.js';
import type { AiTracer } from './types.js';

const logger = getLogger('ai-init');

/** Global Prefactor tracer instance. */
let globalTracer: Tracer | null = null;

/** Global OTEL adapter instance. */
let globalAdapter: AiTracerAdapter | null = null;

/**
 * Initialize the Prefactor AI SDK and return an OTEL-compatible tracer.
 *
 * This is the main entry point for the SDK. Call this function to create a tracer
 * instance that you can pass to the Vercel AI SDK's experimental_telemetry option.
 *
 * @param config - Optional configuration object (same as @prefactor/langchain)
 * @returns AiTracer instance to use with AI SDK's experimental_telemetry
 *
 * @example Basic usage with stdio
 * ```typescript
 * import { init, shutdown } from '@prefactor/ai';
 * import { generateText } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * // Initialize with defaults (stdio transport)
 * const tracer = init();
 *
 * const result = await generateText({
 *   model: anthropic('claude-haiku-4-5'),
 *   prompt: 'Hello!',
 *   experimental_telemetry: {
 *     isEnabled: true,
 *     tracer,
 *   },
 * });
 *
 * await shutdown();
 * ```
 *
 * @example With HTTP transport (production)
 * ```typescript
 * const tracer = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentId: process.env.PREFACTOR_AGENT_ID,
 *   },
 * });
 * ```
 */
export function init(config?: Partial<Config>): AiTracer {
  configureLogging();

  // Build httpConfig from environment if not provided but HTTP transport is requested
  let configWithHttp = config;
  const transportType = config?.transportType ?? process.env.PREFACTOR_TRANSPORT ?? 'stdio';

  if (transportType === 'http' && !config?.httpConfig) {
    const apiUrl = process.env.PREFACTOR_API_URL;
    const apiToken = process.env.PREFACTOR_API_TOKEN;

    if (!apiUrl || !apiToken) {
      throw new Error(
        'HTTP transport requires PREFACTOR_API_URL and PREFACTOR_API_TOKEN environment variables, ' +
          'or httpConfig to be provided in configuration'
      );
    }

    configWithHttp = {
      ...config,
      transportType: 'http',
      httpConfig: {
        apiUrl,
        apiToken,
        agentId: process.env.PREFACTOR_AGENT_ID,
        agentName: process.env.PREFACTOR_AGENT_NAME,
        agentVersion: process.env.PREFACTOR_AGENT_VERSION || '1.0.0', // using this as default version if none provided
      },
    };
  }

  const finalConfig = createConfig(configWithHttp);
  logger.info('Initializing Prefactor AI SDK', { transport: finalConfig.transportType });

  // Return existing adapter if already initialized
  if (globalAdapter !== null) {
    return globalAdapter;
  }

  // Create transport based on configuration
  let transport: Transport;
  if (finalConfig.transportType === 'stdio') {
    transport = new StdioTransport();
  } else {
    if (!finalConfig.httpConfig) {
      throw new Error('HTTP transport requires httpConfig to be provided in configuration');
    }
    if (!finalConfig.httpConfig.agentVersion) {
      throw new Error(
        'HTTP transport requires agentVersion to be provided in httpConfig. ' +
          'Set httpConfig.agentVersion or the PREFACTOR_AGENT_VERSION environment variable.'
      );
    }
    // Parse httpConfig to apply defaults from schema
    const httpConfig = HttpTransportConfigSchema.parse(finalConfig.httpConfig);
    transport = new HttpTransport(httpConfig);
  }

  // Extract partition from agent_id if provided (for HTTP transport)
  let partition: Partition | undefined;
  if (finalConfig.httpConfig?.agentId) {
    try {
      partition = extractPartition(finalConfig.httpConfig.agentId);
      logger.debug('Extracted partition from agent_id', { partition });
    } catch (error) {
      logger.warn('Failed to extract partition from agent_id, using random partition', { error });
    }
  }

  // Create the Prefactor tracer
  globalTracer = new Tracer(transport, partition);

  // Wrap with OTEL adapter
  globalAdapter = new AiTracerAdapter(globalTracer);

  return globalAdapter;
}

/**
 * Get the current tracer instance.
 *
 * If no tracer has been created yet, this will call init() with default configuration.
 *
 * @returns AiTracer instance
 *
 * @example
 * ```typescript
 * import { getTracer } from '@prefactor/ai';
 *
 * const tracer = getTracer();
 *
 * // Use with AI SDK
 * const result = await generateText({
 *   model: anthropic('claude-haiku-4-5'),
 *   prompt: 'Hello!',
 *   experimental_telemetry: { isEnabled: true, tracer },
 * });
 * ```
 */
export function getTracer(): AiTracer {
  if (!globalAdapter) {
    init();
  }
  // Safe because init() always sets globalAdapter
  return globalAdapter as AiTracer;
}

/**
 * Shutdown the SDK and flush any pending spans.
 *
 * Call this before your application exits to ensure all spans are sent to the transport.
 * This is especially important for HTTP transport which has a queue of pending requests.
 *
 * @returns Promise that resolves when shutdown is complete
 *
 * @example
 * ```typescript
 * import { shutdown } from '@prefactor/ai';
 *
 * // At the end of your script or before process exit
 * await shutdown();
 * ```
 *
 * @example With signal handling
 * ```typescript
 * process.on('SIGTERM', async () => {
 *   await shutdown();
 *   process.exit(0);
 * });
 * ```
 */
export async function shutdown(): Promise<void> {
  if (globalTracer) {
    logger.info('Shutting down Prefactor AI SDK');
    await globalTracer.close();
  }
  globalTracer = null;
  globalAdapter = null;
}

// Automatic shutdown on process exit
process.on('beforeExit', () => {
  shutdown().catch((error) => {
    console.error('Error during Prefactor AI SDK shutdown:', error);
  });
});
