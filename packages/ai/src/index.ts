/**
 * Prefactor middleware integration for the Vercel AI SDK.
 *
 * ## What this package is
 *
 * `@prefactor/ai` connects Vercel AI SDK model calls to Prefactor tracing. It captures
 * agent/model/tool span data and sends it through the configured transport.
 *
 * ## What you can do with it
 *
 * - initialize middleware for `wrapLanguageModel` (`init`)
 * - automatically trace non-streaming and streaming calls
 * - create manual spans around custom application logic (`withSpan`)
 * - access the tracer directly for advanced use (`getTracer`)
 *
 * ## Example: wrap a model with Prefactor middleware
 *
 * ```ts
 * import { init, shutdown } from '@prefactor/ai';
 * import { generateText, wrapLanguageModel } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: 'chat-app-v1',
 *   },
 * });
 *
 * const model = wrapLanguageModel({
 *   model: anthropic('claude-3-haiku-20240307'),
 *   middleware,
 * });
 *
 * const result = await generateText({
 *   model,
 *   prompt: 'Hello!',
 * });
 *
 * await shutdown();
 * ```
 *
 * ## Example: manual span around custom code
 *
 * ```ts
 * import { withSpan } from '@prefactor/ai';
 *
 * await withSpan(
 *   {
 *     name: 'hydrate-user-context',
 *     spanType: 'ai-sdk:chain',
 *     inputs: { userId: 'u_123' },
 *   },
 *   async () => {
 *     // custom app logic before/after model calls
 *   }
 * );
 * ```
 *
 * @module @prefactor/packages/ai
 * @category Packages
 * @packageDocumentation
 */

// ============================================================================
// Initialization Exports
// ============================================================================

export { shutdown } from '@prefactor/core';
export { getTracer, init, withSpan } from './init.js';

// ============================================================================
// Middleware Exports
// ============================================================================

export { createPrefactorMiddleware } from './middleware.js';

// ============================================================================
// Type Exports
// ============================================================================

export type { CallData, MiddlewareConfig } from './types.js';

// ============================================================================
// Re-exported Core Types
// ============================================================================

export type {
  Config,
  CoreRuntime,
  ErrorInfo,
  HttpTransportConfig,
  Span,
  TokenUsage,
} from '@prefactor/core';

export { SpanStatus, SpanType } from '@prefactor/core';
