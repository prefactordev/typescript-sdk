import type { AgentInstanceManager } from './agent/instance-manager.js';
import type { Config } from './config.js';
import { createConfig } from './config.js';
import type { CoreRuntime } from './create-core.js';
import { createCore } from './create-core.js';
import type { Tracer } from './tracing/tracer.js';
import { withSpan as coreWithSpan } from './tracing/with-span.js';
import { configureLogging } from './utils/logging.js';

/**
 * Options for creating a manual span around custom code.
 */
export interface ManualSpanOptions {
  /** Human-readable span name. */
  name: string;
  /** Provider-specific span type identifier. */
  spanType: string;
  /** Captured input payload for the span. */
  inputs: Record<string, unknown>;
  /** Optional metadata associated with the span. */
  metadata?: Record<string, unknown>;
}

/**
 * Provider middleware value exposed by integrations.
 */
export type MiddlewareLike = unknown;

/**
 * Provider integration contract for Prefactor SDK clients.
 */
export interface PrefactorProvider<TMiddleware = MiddlewareLike> {
  /**
   * Creates provider middleware bound to the core runtime services.
   *
   * @param tracer - Runtime tracer used for span creation.
   * @param agentManager - Runtime agent instance manager.
   * @param config - Resolved SDK configuration.
   * @returns Provider middleware consumed by upstream frameworks.
   */
  createMiddleware(tracer: Tracer, agentManager: AgentInstanceManager, config: Config): TMiddleware;
  /**
   * Optional provider-level cleanup hook invoked during client shutdown.
   */
  shutdown?: () => void | Promise<void>;
  /**
   * Normalizes a user- or provider-authored agent schema before core registers it.
   *
   * @param agentSchema - Authored agent schema configuration.
   * @returns Normalized schema, or `undefined` to leave the input unchanged.
   */
  normalizeAgentSchema?: (
    agentSchema: Record<string, unknown>
  ) => Record<string, unknown> | undefined;
  /**
   * Provides a default agent schema when a user does not supply one.
   *
   * @returns Agent schema object, or `undefined` when no default is available.
   */
  getDefaultAgentSchema?: () => Record<string, unknown> | undefined;
}

let prefactorClient: PrefactorClient<MiddlewareLike> | null = null;
let prefactorInitKey: string | null = null;

export class PrefactorClient<TMiddleware = MiddlewareLike> {
  private readonly core: CoreRuntime;
  private readonly middleware: TMiddleware;
  private readonly provider: PrefactorProvider<TMiddleware>;

  /**
   * Creates a Prefactor client bound to a runtime and provider middleware.
   *
   * @param core - Initialized core runtime.
   * @param middleware - Provider middleware returned by the integration.
   * @param provider - Provider used to construct the client.
   */
  constructor(
    core: CoreRuntime,
    middleware: TMiddleware,
    provider: PrefactorProvider<TMiddleware>
  ) {
    this.core = core;
    this.middleware = middleware;
    this.provider = provider;
  }

  /**
   * Returns the runtime tracer used by this client.
   *
   * @returns Active tracer instance.
   */
  getTracer(): Tracer {
    return this.core.tracer;
  }

  /**
   * Returns provider middleware created during initialization.
   *
   * @returns Provider middleware object.
   */
  getMiddleware(): TMiddleware {
    return this.middleware;
  }

  /**
   * Runs a function within a manually-created span.
   *
   * @param options - Manual span options.
   * @param fn - Function executed inside the created span.
   * @returns Result of `fn` as a promise.
   */
  withSpan<T>(options: ManualSpanOptions, fn: () => T | Promise<T>): Promise<T> {
    return coreWithSpan(
      this.core.tracer,
      {
        name: options.name,
        spanType: options.spanType as Parameters<typeof coreWithSpan>[0]['spanType'],
        inputs: options.inputs,
        metadata: options.metadata,
      },
      fn
    ) as Promise<T>;
  }

  /**
   * Flushes pending telemetry and releases the global singleton reference.
   *
   * The global client reference is always cleared, even if shutdown fails.
   *
   * @returns Promise that resolves when shutdown completes.
   */
  async shutdown(): Promise<void> {
    try {
      await this.provider.shutdown?.();
      await this.core.shutdown();
    } finally {
      prefactorClient = null;
      prefactorInitKey = null;
    }
  }
}

/**
 * Options for initializing the global Prefactor client.
 */
export interface PrefactorOptions<TMiddleware = MiddlewareLike> {
  /** Provider integration used to create middleware and defaults. */
  provider: PrefactorProvider<TMiddleware>;
  /** Optional HTTP configuration overrides for the runtime config. */
  httpConfig?: Config['httpConfig'];
}

/**
 * Initializes and returns the process-wide Prefactor client singleton.
 *
 * Repeated calls return the same client instance until it is shut down.
 *
 * @param options - Initialization options.
 * @returns Global Prefactor client instance.
 */
export function init<TMiddleware = MiddlewareLike>(
  options: PrefactorOptions<TMiddleware>
): PrefactorClient<TMiddleware> {
  const nextInitKey = buildInitKey(options);

  if (prefactorClient) {
    if (prefactorInitKey !== nextInitKey) {
      throw new Error(
        'Prefactor is already initialized with a different provider or configuration. ' +
          'Call shutdown() before re-initializing with different options.'
      );
    }

    return prefactorClient as PrefactorClient<TMiddleware>;
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

  if (finalConfig.httpConfig?.agentSchema) {
    const normalizedSchema = options.provider.normalizeAgentSchema?.(
      finalConfig.httpConfig.agentSchema
    );
    if (normalizedSchema) {
      finalConfig = {
        ...finalConfig,
        httpConfig: {
          ...finalConfig.httpConfig,
          agentSchema: normalizedSchema,
        },
      };
    }
  }

  const core = createCore(finalConfig);

  const httpConfig = finalConfig.httpConfig;
  if (httpConfig?.agentSchema) {
    core.agentManager.registerSchema(httpConfig.agentSchema);
  }

  const middleware = options.provider.createMiddleware(core.tracer, core.agentManager, finalConfig);

  prefactorClient = new PrefactorClient<TMiddleware>(core, middleware, options.provider);
  prefactorInitKey = nextInitKey;

  return prefactorClient as PrefactorClient<TMiddleware>;
}

/**
 * Returns the currently initialized global Prefactor client, if any.
 *
 * @returns Active global client or `null`.
 */
 export function getClient(): PrefactorClient<MiddlewareLike> | null {
   return prefactorClient
 }

function buildInitKey(options: PrefactorOptions): string {
  const providerType = options.provider.constructor?.name ?? 'anonymous-provider';
  return `${providerType}:${stableStringify(options.httpConfig ?? null)}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      normalized[key] = normalizeValue(objectValue[key]);
    }
    return normalized;
  }

  return value;
}
