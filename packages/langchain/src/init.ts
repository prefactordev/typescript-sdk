import {
  type Config,
  configureLogging,
  createConfig,
  createCore,
  getLogger,
  type CoreRuntime,
  type Tracer,
} from '@prefactor/core';
import { type AgentMiddleware, createMiddleware } from 'langchain';
import { PrefactorMiddleware } from './middleware.js';

const logger = getLogger('init');

let globalCore: CoreRuntime | null = null;
let globalTracer: Tracer | null = null;
let globalMiddleware: AgentMiddleware | null = null;

const defaultAgentSchema = {
  external_identifier: '1.0.0',
  span_schemas: {
    agent: {
      type: 'object',
      properties: { type: { type: 'string', const: 'agent' } },
    },
    llm: {
      type: 'object',
      properties: { type: { type: 'string', const: 'llm' } },
    },
    tool: {
      type: 'object',
      properties: { type: { type: 'string', const: 'tool' } },
    },
    chain: {
      type: 'object',
      properties: { type: { type: 'string', const: 'chain' } },
    },
    retriever: {
      type: 'object',
      properties: { type: { type: 'string', const: 'retriever' } },
    },
  },
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
 * // Initialize with defaults (stdio transport)
 * const middleware = init();
 *
 * // Or configure HTTP transport
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
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

  const finalConfig = createConfig(config);
  logger.info('Initializing Prefactor SDK', { transport: finalConfig.transportType });

  if (globalMiddleware !== null) {
    return globalMiddleware;
  }

  const core = createCore(finalConfig);
  globalCore = core;
  globalTracer = core.tracer;
  core.agentManager.registerSchema(defaultAgentSchema);

  const agentInfo = finalConfig.httpConfig
    ? {
        agentId: finalConfig.httpConfig.agentId,
        agentVersion: finalConfig.httpConfig.agentVersion,
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
 * Shutdown the SDK and flush any pending spans.
 *
 * Call this before your application exits to ensure all spans are sent to the transport.
 * This is especially important for HTTP transport which has a queue of pending requests.
 *
 * @returns Promise that resolves when shutdown is complete
 *
 * @example
 * ```typescript
 * import { shutdown } from '@prefactor/langchain';
 *
 * process.on('SIGTERM', async () => {
 *   await shutdown();
 *   process.exit(0);
 * });
 * ```
 */
export async function shutdown(): Promise<void> {
  if (globalCore) {
    logger.info('Shutting down Prefactor SDK');
    await globalCore.shutdown();
  }
  globalCore = null;
  globalTracer = null;
  globalMiddleware = null;
}

// Automatic shutdown on process exit
process.on('beforeExit', () => {
  shutdown().catch((error) => {
    console.error('Error during Prefactor SDK shutdown:', error);
  });
});
