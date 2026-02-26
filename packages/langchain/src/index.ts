/**
 * LangChain adapter package exposing Prefactor initialization helpers and middleware.
 *
 * ## `@prefactor/langchain` overview
 *
 * `@prefactor/langchain` adds Prefactor tracing to LangChain middleware so agent, model,
 * chain, and tool activity is captured automatically.
 *
 * The package initializes once with `init`, then captures model and tool traces through
 * LangChain middleware hooks. It also exposes `withSpan` for custom orchestration spans and
 * `getTracer` for advanced instrumentation patterns.
 *
 * ## Quick start: initialize and attach middleware
 *
 * ```ts
 * import { init } from '@prefactor/langchain';
 * import { createAgent } from 'langchain';
 *
 * const prefactor = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: 'support-bot-v1',
 *   },
 * });
 *
 * const agent = createAgent({
 *   model: 'claude-sonnet-4-5-20250929',
 *   tools: [],
 *   middleware: [prefactor],
 * });
 * ```
 *
 * ## Example: trace custom logic
 *
 * ```ts
 * import { withSpan } from '@prefactor/langchain';
 *
 * await withSpan(
 *   {
 *     name: 'rank-documents',
 *     spanType: 'langchain:chain',
 *     inputs: { count: 12 },
 *   },
 *   async () => {
 *     // your custom chain logic
 *   }
 * );
 * ```
 *
 * @module @prefactor/packages/langchain
 * @category Packages
 * @packageDocumentation
 */

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
