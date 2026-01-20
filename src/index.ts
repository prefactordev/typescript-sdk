import { extractPartition, type Partition } from '@prefactor/pfid';
import { Tracer } from './tracing/tracer.js';
import { PrefactorMiddleware } from './instrumentation/langchain/middleware.js';
import { StdioTransport } from './transport/stdio.js';
import { HttpTransport } from './transport/http.js';
import { createConfig, HttpTransportConfigSchema, type Config } from './config.js';
import { configureLogging, getLogger } from './utils/logging.js';
import { createMiddleware, type AgentMiddleware } from 'langchain';

const logger = getLogger('init');

let globalTracer: Tracer | null = null;
let globalMiddleware: AgentMiddleware | null = null;

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
 * import { init } from '@prefactor/sdk';
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

  let transport;
  if (finalConfig.transportType === 'stdio') {
    transport = new StdioTransport();
  } else {
    if (!finalConfig.httpConfig) {
      throw new Error('HTTP transport requires httpConfig to be provided in configuration');
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

  globalTracer = new Tracer(transport, partition);
  const prefactorMiddleware = new PrefactorMiddleware(globalTracer);

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
 * import { getTracer } from '@prefactor/sdk';
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
  return globalTracer!;
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
 * import { shutdown } from '@prefactor/sdk';
 *
 * process.on('SIGTERM', async () => {
 *   await shutdown();
 *   process.exit(0);
 * });
 * ```
 */
export async function shutdown(): Promise<void> {
  if (globalTracer) {
    logger.info('Shutting down Prefactor SDK');
    await globalTracer.close();
  }
  globalTracer = null;
  globalMiddleware = null;
}

// Automatic shutdown on process exit
process.on('beforeExit', () => {
  shutdown().catch((error) => {
    console.error('Error during Prefactor SDK shutdown:', error);
  });
});

// Re-export types for consumer convenience
export type { Config, HttpTransportConfig } from './config.js';
export { SpanType, SpanStatus } from './tracing/span.js';
export type { Span, TokenUsage, ErrorInfo } from './tracing/span.js';
export { PrefactorMiddleware } from './instrumentation/langchain/middleware.js';
export { Tracer } from './tracing/tracer.js';
