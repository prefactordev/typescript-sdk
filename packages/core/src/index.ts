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

// HTTP Client & API Clients
export { HttpClient, HttpClientError, type HttpRequester } from './transport/http/http-client.js';
export {
  AgentInstanceClient,
  type AgentInstanceRegisterPayload,
  type AgentInstanceResponse,
  type AgentInstanceStartOptions,
  type AgentInstanceFinishOptions,
} from './transport/http/agent-instance-client.js';
export {
  AgentSpanClient,
  type AgentSpanCreatePayload,
  type AgentSpanResponse,
  type AgentSpanStatus,
  type AgentSpanFinishOptions,
} from './transport/http/agent-span-client.js';

// Utilities
export { configureLogging, getLogger } from './utils/logging.js';
export { serializeValue, truncateString } from './utils/serialization.js';
