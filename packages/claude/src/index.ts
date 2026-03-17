/**
 * Prefactor tracing integration for the Claude Agent SDK.
 *
 * ## `@prefactor/claude` overview
 *
 * `@prefactor/claude` connects Claude Agent SDK sessions to Prefactor tracing. It captures
 * agent, LLM, tool, and subagent spans and sends them through your configured transport.
 *
 * Use this package as a provider for the core `init` function.
 *
 * ## Quick start
 *
 * ```ts
 * import { init } from '@prefactor/core';
 * import { PrefactorClaude } from '@prefactor/claude';
 *
 * const prefactor = init({
 *   provider: new PrefactorClaude(),
 *   httpConfig: {
 *     apiUrl: 'https://app.prefactorai.com',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: 'my-claude-agent',
 *   },
 * });
 *
 * const { tracedQuery } = prefactor.getMiddleware();
 *
 * for await (const msg of tracedQuery({
 *   prompt: 'Explain this codebase',
 *   options: { allowedTools: ['Read', 'Glob', 'Grep'] },
 * })) {
 *   if ('result' in msg) console.log(msg.result);
 * }
 *
 * await prefactor.shutdown();
 * ```
 *
 * @module @prefactor/claude
 * @category Packages
 * @packageDocumentation
 */

export type { PrefactorClaudeOptions } from './provider.js';
// Provider
export { DEFAULT_CLAUDE_AGENT_SCHEMA, PrefactorClaude } from './provider.js';

// Types
export type {
  ClaudeMiddleware,
  ClaudeMiddlewareConfig,
  JsonSchema,
  ToolSchemaConfig,
} from './types.js';
