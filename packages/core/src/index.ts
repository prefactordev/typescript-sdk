// Tracing

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
  HttpClient,
  HttpClient as HTTPClient,
  HttpClientError,
} from './transport/http/http-client.js';
// Transport
export type { AgentInstanceOptions, Transport } from './transport/http.js';
export { HttpTransport } from './transport/http.js';

// Utilities
export { configureLogging, getLogger } from './utils/logging.js';
export { serializeValue, truncateString } from './utils/serialization.js';
