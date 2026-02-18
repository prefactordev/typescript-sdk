/**
 * Shared runtime, tracing primitives, and transport abstractions for Prefactor SDK adapters.
 *
 * ## `@prefactor/core` overview
 *
 * `@prefactor/core` is the foundation for Prefactor integrations. Use it when you want direct
 * control over tracing lifecycle, transport behavior, and custom instrumentation in your app.
 *
 * The package supports validated runtime configuration through `createConfig`, runtime
 * initialization through `createCore`, manual instrumentation through `withSpan` and
 * `Tracer.startSpan`, and graceful lifecycle handling with `shutdown` and
 * `registerShutdownHandler`.
 *
 * ## Quick start: initialize runtime directly
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
 * ## Example: instrument custom work
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
export {
  AgentInstanceClient,
  type AgentInstanceFinishOptions,
  type AgentInstanceRegisterPayload,
  type AgentInstanceResponse,
  type AgentInstanceStartOptions,
} from './transport/http/agent-instance-client.js';
export {
  AgentSpanClient,
  type AgentSpanCreatePayload,
  type AgentSpanFinishOptions,
  type AgentSpanResponse,
  type AgentSpanStatus,
} from './transport/http/agent-span-client.js';

// HTTP Client & API Clients
export {
  HttpClient,
  HttpClientError,
  type HttpRequester,
} from './transport/http/http-client.js';
// Transport
export type { AgentInstanceOptions, Transport } from './transport/http.js';
export { HttpTransport } from './transport/http.js';

// Utilities
export { configureLogging, getLogger } from './utils/logging.js';
export { serializeValue, truncateString } from './utils/serialization.js';
