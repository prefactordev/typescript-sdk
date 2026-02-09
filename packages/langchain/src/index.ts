// Main entry points

// Convenience re-exports from core
export {
  type Config,
  type CoreRuntime,
  type HttpTransportConfig,
  type Span,
  SpanStatus,
  SpanType,
  shutdown,
} from '@prefactor/core';
export { getTracer, init, withSpan } from './init.js';
export { extractTokenUsage } from './metadata-extractor.js';
// Middleware
export { PrefactorMiddleware } from './middleware.js';
