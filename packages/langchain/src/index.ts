/**
 * LangChain adapter package exposing Prefactor initialization helpers and middleware.
 *
 * ## What this package is
 *
 * `@prefactor/langchain` integrates Prefactor tracing with LangChain middleware so you can
 * observe agent, model, chain, and tool execution without wiring low-level tracing by hand.
 *
 * ## What you can do with it
 *
 * - initialize once and attach middleware to LangChain agents (`init`)
 * - capture token usage and structured span payloads automatically
 * - add manual spans around custom orchestration (`withSpan`)
 * - access the underlying tracer for advanced instrumentation (`getTracer`)
 *
 * ## Example: initialize and attach middleware
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
 * ## Example: manual span for custom logic
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
