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
import { type AgentMiddleware, createMiddleware } from 'langchain';
import { PrefactorMiddleware } from './middleware.js';
import { DEFAULT_LANGCHAIN_AGENT_SCHEMA, normalizeAgentSchema } from './schema.js';

const logger = getLogger('init');

let globalCore: CoreRuntime | null = null;
let globalTracer: Tracer | null = null;
let globalMiddleware: AgentMiddleware | null = null;
let globalPrefactorMiddleware: PrefactorMiddleware | null = null;

registerShutdownHandler('prefactor-langchain', () => {
  globalPrefactorMiddleware?.shutdown();

  if (globalCore) {
    logger.info('Shutting down Prefactor SDK');
  }

  globalCore = null;
  globalTracer = null;
  globalMiddleware = null;
  globalPrefactorMiddleware = null;
});

export type ManualSpanOptions = {
  /** Span name shown in traces. */
  name: string;
  /** Provider-prefixed span type (for example `langchain:tool`). */
  spanType: string;
  /** Inputs recorded for the wrapped work. */
  inputs: Record<string, unknown>;
  /** Optional additional metadata to attach to the span. */
  metadata?: Record<string, unknown>;
};

/**
 * Initialize the Prefactor SDK and return middleware for LangChain.js
 *
 * This is the main entry point for the SDK. Call this function to create a middleware
 * instance that you can pass to your LangChain.js agents.
 *
 * @param config - Optional configuration object
 * @returns PrefactorMiddleware instance to use with LangChain.js agents
 *
 * @example
 * ```typescript
 * import { init } from '@prefactor/langchain';
 * import { createAgent } from 'langchain';
 *
 * // Initialize with HTTP transport
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://app.prefactorai.com',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: 'my-langchain-agent',
 *   },
 * });
 *
 * // Or configure HTTP transport
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://app.prefactorai.com',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: 'my-langchain-agent', // Required
 *     agentId: 'legacy-agent-id', // Optional legacy identifier
 *   }
 * });
 *
 * const agent = createAgent({
 *   model: 'claude-sonnet-4-5-20250929',
 *   tools: [myTool],
 *   middleware: [middleware],
 * });
 * ```
 */
export function init(config?: Partial<Config>): AgentMiddleware {
  if (globalMiddleware !== null) {
    return globalMiddleware;
  }
  
  configureLogging();
  const preparedConfig = applyDefaultHttpConfig(config);
  const { config: finalConfig, toolSpanTypes } = normalizeConfiguredAgentSchema(
    createConfig(preparedConfig)
  );

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

  const prefactorMiddleware = new PrefactorMiddleware(
    core.tracer,
    core.agentManager,
    agentInfo,
    toolSpanTypes
  );

  const middleware = createMiddleware({
    name: 'prefactor',
    // biome-ignore lint/suspicious/noExplicitAny: LangChain middleware hooks use dynamic types
    wrapModelCall: async (request: any, handler: any) => {
      return prefactorMiddleware.wrapModelCall(request, handler);
    },
    // biome-ignore lint/suspicious/noExplicitAny: LangChain middleware hooks use dynamic types
    wrapToolCall: async (request: any, handler: any) => {
      return prefactorMiddleware.wrapToolCall(request, handler);
    },
    // biome-ignore lint/suspicious/noExplicitAny: LangChain middleware hooks use dynamic types
    beforeAgent: async (state: any) => {
      await prefactorMiddleware.beforeAgent(state);
    },
    // biome-ignore lint/suspicious/noExplicitAny: LangChain middleware hooks use dynamic types
    afterAgent: async (state: any) => {
      await prefactorMiddleware.afterAgent(state);
    },
  });

  globalMiddleware = middleware;
  globalPrefactorMiddleware = prefactorMiddleware;
  return middleware;
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
 * import { getTracer } from '@prefactor/langchain';
 *
 * const tracer = getTracer();
 * const span = tracer.startSpan({
 *   name: 'custom-operation',
 *   spanType: SpanType.TOOL,
 *   inputs: { data: 'example' }
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
 * Wraps a function in a manual span using the shared core helper.
 *
 * @param options - Manual span options.
 * @param fn - Function to execute in span context.
 * @returns Result from `fn`.
 */
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
    logger.error('Error during Prefactor SDK shutdown:', error);
  });
});

function applyDefaultHttpConfig(config?: Partial<Config>): Partial<Config> | undefined {
  const transportType = config?.transportType ?? 'http';
  if (transportType !== 'http') {
    return config;
  }

  if (!config?.httpConfig) {
    return buildHttpConfigFromEnvironment(config);
  }

  if (config.httpConfig.agentSchema) {
    return config;
  }

  return {
    ...config,
    httpConfig: {
      ...config.httpConfig,
      agentSchema: DEFAULT_LANGCHAIN_AGENT_SCHEMA,
    },
  };
}

function buildHttpConfigFromEnvironment(config?: Partial<Config>): Partial<Config> {
  const apiUrl = process.env.PREFACTOR_API_URL;
  const apiToken = process.env.PREFACTOR_API_TOKEN;

  if (!apiUrl || !apiToken) {
    throw new Error(
      'HTTP transport requires PREFACTOR_API_URL and PREFACTOR_API_TOKEN environment variables, ' +
        'or httpConfig to be provided in configuration'
    );
  }

  return {
    ...config,
    transportType: 'http',
    httpConfig: {
      apiUrl,
      apiToken,
      agentId: process.env.PREFACTOR_AGENT_ID,
      agentName: process.env.PREFACTOR_AGENT_NAME,
      agentIdentifier: process.env.PREFACTOR_AGENT_IDENTIFIER || '1.0.0',
      agentSchema: DEFAULT_LANGCHAIN_AGENT_SCHEMA,
    },
  };
}

function normalizeConfiguredAgentSchema(config: Config): {
  config: Config;
  toolSpanTypes?: Record<string, string>;
} {
  if (!config.httpConfig?.agentSchema) {
    return { config };
  }

  const normalizedSchema = normalizeAgentSchema(config.httpConfig.agentSchema);
  return {
    config: {
      ...config,
      httpConfig: {
        ...config.httpConfig,
        agentSchema: normalizedSchema.agentSchema,
      },
    },
    toolSpanTypes: normalizedSchema.toolSpanTypes,
  };
}
