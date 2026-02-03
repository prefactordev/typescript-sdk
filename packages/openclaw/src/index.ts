// Main entry points

// Re-exports from core for convenience
export type {
  Config,
  CoreRuntime,
  ErrorInfo,
  HttpTransportConfig,
  Span,
  TokenUsage,
} from '@prefactor/core';
export { SpanStatus, SpanType } from '@prefactor/core';

export { getTracer, init, register, shutdown } from './init.js';
export type { OpenClawPluginApi, PluginConfig } from './types.js';
