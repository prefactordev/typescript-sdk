import type { AgentInstanceManager } from './agent/instance-manager.js';
import type { Config } from './config.js';
import { createConfig } from './config.js';
import type { CoreRuntime } from './create-core.js';
import { createCore } from './create-core.js';
import type { Tracer } from './tracing/tracer.js';
import { withSpan as coreWithSpan } from './tracing/with-span.js';
import { configureLogging } from './utils/logging.js';

export interface ManualSpanOptions {
  name: string;
  spanType: string;
  inputs: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type MiddlewareLike = unknown;

export interface PrefactorProvider {
  createMiddleware(
    tracer: Tracer,
    agentManager: AgentInstanceManager,
    config: Config
  ): MiddlewareLike;
  // biome-ignore lint/suspicious/noExplicitAny: Optional method for providers that support default schemas
  getDefaultAgentSchema?: () => any;
}

let globalClient: PrefactorClient | null = null;

export class PrefactorClient {
  private readonly core: CoreRuntime;
  private readonly middleware: MiddlewareLike;

  constructor(core: CoreRuntime, middleware: MiddlewareLike, _provider: PrefactorProvider) {
    this.core = core;
    this.middleware = middleware;
  }

  getTracer(): Tracer {
    return this.core.tracer;
  }

  getMiddleware(): MiddlewareLike {
    return this.middleware;
  }

  withSpan<T>(options: ManualSpanOptions, fn: () => T | Promise<T>): Promise<T> {
    return coreWithSpan(
      {
        name: options.name,
        spanType: options.spanType as Parameters<typeof coreWithSpan>[0]['spanType'],
        inputs: options.inputs,
        metadata: options.metadata,
      },
      fn
    ) as Promise<T>;
  }

  async shutdown(): Promise<void> {
    await this.core.shutdown();
    globalClient = null;
  }
}

export interface PrefactorOptions {
  provider: PrefactorProvider;
  httpConfig?: Config['httpConfig'];
}

export function init(options: PrefactorOptions): PrefactorClient {
  if (globalClient) {
    return globalClient;
  }

  configureLogging();

  const config: Partial<Config> = options.httpConfig ? { httpConfig: options.httpConfig } : {};
  let finalConfig = createConfig(config);

  const providerSchema = options.provider.getDefaultAgentSchema?.();
  if (!finalConfig.httpConfig?.agentSchema && providerSchema && finalConfig.httpConfig) {
    finalConfig = {
      ...finalConfig,
      httpConfig: {
        ...finalConfig.httpConfig,
        agentSchema: providerSchema,
      },
    };
  }

  const core = createCore(finalConfig);

  const httpConfig = finalConfig.httpConfig;
  if (httpConfig?.agentSchema) {
    core.agentManager.registerSchema(httpConfig.agentSchema);
  }

  const middleware = options.provider.createMiddleware(core.tracer, core.agentManager, finalConfig);

  globalClient = new PrefactorClient(core, middleware, options.provider);

  return globalClient;
}

export function getClient(): PrefactorClient | null {
  return globalClient;
}
