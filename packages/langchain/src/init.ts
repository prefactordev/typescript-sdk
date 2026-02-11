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

const logger = getLogger('init');

const DEFAULT_LANGCHAIN_AGENT_SCHEMA = {
  external_identifier: 'langchain-schema',
  span_schemas: {
    'langchain:agent': { type: 'object', additionalProperties: true },
    'langchain:llm': { type: 'object', additionalProperties: true },
    'langchain:tool': { type: 'object', additionalProperties: true },
    'langchain:chain': { type: 'object', additionalProperties: true },
  },
} as const;

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
  name: string;
  spanType: string;
  inputs: Record<string, unknown>;
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
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: 'my-langchain-agent',
 *   },
 * });
 *
 * // Or configure HTTP transport
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
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
  configureLogging();

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
        agentSchema: DEFAULT_LANGCHAIN_AGENT_SCHEMA,
      },
    };
  } else if (transportType === 'http' && config?.httpConfig && !config.httpConfig.agentSchema) {
    configWithHttp = {
      ...config,
      httpConfig: {
        ...config.httpConfig,
        agentSchema: DEFAULT_LANGCHAIN_AGENT_SCHEMA,
      },
    };
  }

  const finalConfig = createConfig(configWithHttp);

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

  const prefactorMiddleware = new PrefactorMiddleware(core.tracer, core.agentManager, agentInfo);

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
    console.error('Error during Prefactor SDK shutdown:', error);
  });
});
