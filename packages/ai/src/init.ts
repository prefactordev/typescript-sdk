/**
 * @fileoverview Initialization module for AI SDK middleware with Prefactor.
 *
 * This module provides the main entry points for configuring and managing
 * the Prefactor middleware for use with Vercel AI SDK's wrapLanguageModel.
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
import { createPrefactorMiddleware } from './middleware.js';
import type { MiddlewareConfig } from './types.js';

const logger = getLogger('ai-middleware-init');

/** Global Prefactor tracer instance. */
let globalTracer: Tracer | null = null;

/** Global middleware instance. */
let globalMiddleware: ReturnType<typeof createPrefactorMiddleware> | null = null;

/**
 * Initialize the Prefactor AI middleware and return it for use with wrapLanguageModel.
 *
 * This is the main entry point for the SDK. Call this function to create a middleware
 * instance that you can pass to the Vercel AI SDK's wrapLanguageModel function.
 *
 * @param config - Optional configuration object for transport settings
 * @param middlewareConfig - Optional middleware-specific configuration
 * @returns Middleware object to use with wrapLanguageModel
 *
 * @example Basic usage with stdio (development)
 * ```typescript
 * import { init, shutdown } from '@prefactor/ai-middleware';
 * import { generateText, wrapLanguageModel } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * // Initialize with defaults (stdio transport)
 * const middleware = init();
 *
 * // Wrap your model with the middleware
 * const model = wrapLanguageModel({
 *   model: anthropic('claude-3-haiku-20240307'),
 *   middleware,
 * });
 *
 * const result = await generateText({
 *   model,
 *   prompt: 'Hello!',
 * });
 *
 * await shutdown();
 * ```
 *
 * @example With HTTP transport (production)
 * ```typescript
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentId: process.env.PREFACTOR_AGENT_ID,
 *     agentVersion: '1.0.0',
 *   },
 * });
 * ```
 *
 * @example With middleware configuration
 * ```typescript
 * const middleware = init(
 *   { transportType: 'stdio' },
 *   { captureContent: false } // Don't capture prompts/responses
 * );
 * ```
 */
export function init(
  config?: Partial<Config>,
  middlewareConfig?: MiddlewareConfig
): ReturnType<typeof createPrefactorMiddleware> {
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
        agentVersion: process.env.PREFACTOR_AGENT_VERSION || '1.0.0',
      },
    };
  }

  const finalConfig = createConfig(configWithHttp);
  logger.info('Initializing Prefactor AI Middleware', { transport: finalConfig.transportType });

  // Return existing middleware if already initialized
  if (globalMiddleware !== null) {
    return globalMiddleware;
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

  // Create the middleware
  globalMiddleware = createPrefactorMiddleware(globalTracer, middlewareConfig);

  return globalMiddleware;
}

/**
 * Get the current tracer instance.
 *
 * If no tracer has been created yet, this will call init() with default configuration.
 *
 * @returns Tracer instance
 *
 * @example
 * ```typescript
 * import { getTracer } from '@prefactor/ai-middleware';
 *
 * const tracer = getTracer();
 * // Use for custom span creation
 * const span = tracer.startSpan({
 *   name: 'custom-operation',
 *   spanType: SpanType.CHAIN,
 * });
 * ```
 */
export function getTracer(): Tracer {
  if (!globalTracer) {
    init();
  }
  // Safe because init() always sets globalTracer
  return globalTracer as Tracer;
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
 * import { shutdown } from '@prefactor/ai-middleware';
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
    logger.info('Shutting down Prefactor AI Middleware');
    await globalTracer.close();
  }
  globalTracer = null;
  globalMiddleware = null;
}

// Automatic shutdown on process exit
process.on('beforeExit', () => {
  shutdown().catch((error) => {
    console.error('Error during Prefactor AI Middleware shutdown:', error);
  });
});
