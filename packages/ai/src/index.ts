/**
 * Prefactor middleware integration for the Vercel AI SDK.
 *
 * ## `@prefactor/ai` overview
 *
 * `@prefactor/ai` connects Vercel AI SDK model calls to Prefactor tracing. It captures
 * agent, model, and tool spans and sends them through your configured transport.
 *
 * The package initializes middleware for `wrapLanguageModel` through `init`, traces both
 * non-streaming and streaming calls automatically, and exposes `withSpan` plus `getTracer`
 * for custom instrumentation needs.
 *
 * ## Quick start: wrap a model with Prefactor middleware
 *
 * ```ts
 * import { init, shutdown } from '@prefactor/ai';
 * import { generateText, wrapLanguageModel } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://app.prefactorai.com',
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
 * ## Example: trace custom code
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
