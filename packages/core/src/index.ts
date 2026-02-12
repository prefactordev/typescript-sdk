/**
 * Shared runtime, tracing primitives, and transport abstractions for Prefactor SDK adapters.
 *
 * ## What this package is
 *
 * `@prefactor/core` is the low-level building block used by adapter packages like
 * `@prefactor/ai` and `@prefactor/langchain`. It gives you full control over tracer lifecycle,
 * span creation, configuration, and transport behavior.
 *
 * ## What you can do with it
 *
 * - create validated runtime config from env + code (`createConfig`)
 * - initialize a core runtime (`createCore`) and access tracer/agent manager
 * - create manual spans (`withSpan`, `Tracer.startSpan`) for custom instrumentation
 * - manage graceful teardown (`shutdown`, `registerShutdownHandler`)
 *
 * ## Example: initialize runtime directly
 *
 * ```ts
 * import { createConfig, createCore } from '@prefactor/core';
 *
 * const config = createConfig({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: '1.0.0',
 *   },
 * });
 *
 * const core = createCore(config);
 * // core.tracer, core.agentManager, core.shutdown()
 * ```
 *
 * ## Example: wrap custom work in a span
 *
 * ```ts
 * import { withSpan } from '@prefactor/core';
 *
 * const result = await withSpan(
 *   {
 *     name: 'custom-operation',
 *     spanType: 'app:task',
 *     inputs: { jobId: 'job-123' },
 *   },
 *   async () => {
 *     return { ok: true };
 *   }
 * );
 * ```
 *
 * @module @prefactor/core
 * @category Core
 * @packageDocumentation
 */

// Agent
export { AgentInstanceManager } from './agent/instance-manager.js';
// Config
export {
  type Config,
  ConfigSchema,
  createConfig,
  type HttpTransportConfig,
  HttpTransportConfigSchema,
  type PartialHttpConfig,
  PartialHttpConfigSchema,
} from './config.js';
export { type CoreRuntime, createCore } from './create-core.js';
export { registerShutdownHandler, shutdown } from './lifecycle.js';
export { SpanContext } from './tracing/context.js';
export {
  createSpanTypePrefixer,
  type ErrorInfo,
  type Span,
  SpanStatus,
  SpanType,
  type TokenUsage,
} from './tracing/span.js';
export { type EndSpanOptions, type StartSpanOptions, Tracer } from './tracing/tracer.js';
export { withSpan } from './tracing/with-span.js';
// Transport
export type { AgentInstanceOptions, Transport } from './transport/http.js';
export { HttpTransport } from './transport/http.js';

// Utilities
export { configureLogging, getLogger } from './utils/logging.js';
export { serializeValue, truncateString } from './utils/serialization.js';
