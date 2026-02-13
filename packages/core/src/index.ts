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
  HttpClient as HTTPClient,
  HttpClientError,
  type HttpRequester,
} from './transport/http/http-client.js';
// Transport
export type { AgentInstanceOptions, Transport } from './transport/http.js';
export { HttpTransport } from './transport/http.js';

// Utilities
export { configureLogging, getLogger } from './utils/logging.js';
export { serializeValue, truncateString } from './utils/serialization.js';
