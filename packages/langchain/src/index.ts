/**
 * LangChain adapter package exposing Prefactor initialization helpers and middleware.
 *
 * ## `@prefactor/langchain` overview
 *
 * `@prefactor/langchain` adds Prefactor tracing to LangChain middleware so agent, model,
 * chain, and tool activity is captured automatically.
 *
 * Use this package as a provider for the core `init` function.
 *
 * ## Quick start
 *
 * ```ts
 * import { init } from '@prefactor/core';
 * import { PrefactorLangChain } from '@prefactor/langchain';
 * import { createAgent } from 'langchain';
 *
 * const prefactor = init({
 *   provider: new PrefactorLangChain(),
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
 *   middleware: [prefactor.getMiddleware()],
 * });
 * ```
 *
 * @module @prefactor/packages/langchain
 * @category Packages
 * @packageDocumentation
 */

// Re-export middleware type
export type { AgentMiddleware } from 'langchain';
// Provider
export { DEFAULT_LANGCHAIN_AGENT_SCHEMA, PrefactorLangChain } from './provider.js';
