// Main entry points

// Convenience re-exports from core
export {
  type Config,
  type HttpTransportConfig,
  type Span,
  SpanStatus,
  SpanType,
} from '@prefactor/core';
export { getTracer, init, shutdown } from './init.js';
export { extractTokenUsage } from './metadata-extractor.js';
// Middleware
export { PrefactorMiddleware } from './middleware.js';
