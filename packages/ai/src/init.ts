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
  type CoreRuntime,
  configureLogging,
  createConfig,
  createCore,
  getLogger,
  registerShutdownHandler,
  shutdown as shutdownCore,
  type Tracer,
  withSpan as withCoreSpan,
} from '@prefactor/core';
import { createPrefactorMiddleware, endRootAgentSpan } from './middleware.js';
import type { MiddlewareConfig } from './types.js';

const logger = getLogger('ai-init');

const DEFAULT_AI_AGENT_SCHEMA = {
  external_identifier: 'ai-sdk-schema',
  span_schemas: {
    'ai:agent': { type: 'object', additionalProperties: true },
    'ai:llm': { type: 'object', additionalProperties: true },
    'ai:tool': { type: 'object', additionalProperties: true },
    'ai:chain': { type: 'object', additionalProperties: true },
  },
} as const;

/** Global Prefactor tracer instance. */
let globalTracer: Tracer | null = null;
let globalCore: CoreRuntime | null = null;
let agentLifecycle: { started: boolean } | null = null;

/** Global middleware instance. */
let globalMiddleware: ReturnType<typeof createPrefactorMiddleware> | null = null;

registerShutdownHandler('prefactor-ai', async () => {
  if (globalCore) {
    logger.info('Shutting down Prefactor AI Middleware');
    if (globalTracer) {
      endRootAgentSpan(globalTracer);
    }
    if (agentLifecycle?.started) {
      globalCore.agentManager.finishInstance();
      agentLifecycle.started = false;
    }
  }

  globalCore = null;
  globalTracer = null;
  globalMiddleware = null;
  agentLifecycle = null;
});

export type ManualSpanOptions = {
  name: string;
  spanType: string;
  inputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

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
 * @example Basic usage with HTTP transport
 * ```typescript
 * import { init, shutdown } from '@prefactor/ai';
 * import { generateText, wrapLanguageModel } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * // Initialize with HTTP transport config
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: '1.0.0',
 *   },
 * });
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
 *     agentIdentifier: '1.0.0',
 *   },
 * });
 * ```
 *
 * @example With middleware configuration
 * ```typescript
 * const middleware = init(
 *   {
 *     transportType: 'http',
 *     httpConfig: {
 *       apiUrl: 'https://api.prefactor.ai',
 *       apiToken: process.env.PREFACTOR_API_TOKEN!,
 *       agentIdentifier: '1.0.0',
 *     },
 *   },
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
  const transportType = config?.transportType ?? process.env.PREFACTOR_TRANSPORT ?? 'http';

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
        agentIdentifier: process.env.PREFACTOR_AGENT_IDENTIFIER || '1.0.0',
        agentSchema: DEFAULT_AI_AGENT_SCHEMA,
      },
    };
  } else if (transportType === 'http' && config?.httpConfig && !config.httpConfig.agentSchema) {
    configWithHttp = {
      ...config,
      httpConfig: {
        ...config.httpConfig,
        agentSchema: DEFAULT_AI_AGENT_SCHEMA,
      },
    };
  }

  const finalConfig = createConfig(configWithHttp);
  logger.info('Initializing Prefactor AI Middleware', { transport: finalConfig.transportType });

  // Return existing middleware if already initialized
  if (globalMiddleware !== null) {
    return globalMiddleware;
  }

  const core = createCore(finalConfig);
  globalCore = core;
  globalTracer = core.tracer;

  const httpConfig = finalConfig.httpConfig;
  if (httpConfig?.agentSchema) {
    core.agentManager.registerSchema(httpConfig.agentSchema);
  }

  const agentInfo = finalConfig.httpConfig
    ? {
        agentId: finalConfig.httpConfig.agentId,
        agentIdentifier: finalConfig.httpConfig.agentIdentifier,
        agentName: finalConfig.httpConfig.agentName,
        agentDescription: finalConfig.httpConfig.agentDescription,
      }
    : undefined;
  agentLifecycle = { started: false };

  // Create the middleware
  globalMiddleware = createPrefactorMiddleware(core.tracer, middlewareConfig, {
    agentInfo,
    agentManager: core.agentManager,
    agentLifecycle,
  });

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
 * import { getTracer } from '@prefactor/ai';
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

export async function withSpan<T>(
  options: ManualSpanOptions,
  fn: () => Promise<T> | T
): Promise<T> {
  return withCoreSpan(options, fn);
}

export { shutdownCore as shutdown };

// Automatic shutdown on process exit
process.on('beforeExit', () => {
  shutdownCore().catch((error) => {
    console.error('Error during Prefactor AI Middleware shutdown:', error);
  });
});
