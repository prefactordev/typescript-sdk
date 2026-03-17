/**
 * Prefactor middleware integration for the Vercel AI SDK.
 *
 * ## `@prefactor/ai` overview
 *
 * `@prefactor/ai` connects Vercel AI SDK model calls to Prefactor tracing. It captures
 * agent, model, and tool spans and sends them through your configured transport.
 *
 * Use this package as a provider for the core `init` function.
 *
 * ## Quick start
 *
 * ```ts
 * import { init } from '@prefactor/core';
 * import { PrefactorAISDK } from '@prefactor/ai';
 * import { generateText, wrapLanguageModel } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const prefactor = init({
 *   provider: new PrefactorAISDK(),
 *   httpConfig: {
 *     apiUrl: 'https://app.prefactorai.com',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: 'chat-app-v1',
 *   },
 * });
 *
 * const model = wrapLanguageModel({
 *   model: anthropic('claude-3-haiku-20240307'),
 *   middleware: prefactor.getMiddleware(),
 * });
 *
 * const result = await generateText({
 *   model,
 *   prompt: 'Hello!',
 * });
 *
 * await prefactor.shutdown();
 * ```
 *
 * @module @prefactor/ai
 * @category Packages
 * @packageDocumentation
 */

export type { ManualSpanOptions } from './init.js';
// Initialization
export { getTracer, init, shutdown, withSpan } from './init.js';
export type { PrefactorAISDKOptions } from './provider.js';
// Provider
export { DEFAULT_AI_AGENT_SCHEMA, PrefactorAISDK } from './provider.js';

// Types
export type {
  JsonSchema,
  LanguageModelMiddleware,
  MiddlewareConfig,
  ToolSchemaConfig,
} from './types.js';
