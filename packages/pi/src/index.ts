/**
 * pi coding agent extension for Prefactor observability. Records each pi session as a Prefactor
 * agent instance, as a conversation of user turns, assistant turns, LLM calls and tool executions.
 *
 * ## `@prefactor/pi` overview
 *
 * `@prefactor/pi` is a [pi](https://pi.dev) extension. Each pi session becomes one Prefactor
 * agent instance, which Prefactor shows as a conversation. It works with the `pi` command and
 * with agents built on pi's SDK.
 *
 * The extension records prompts, completions and tool results as they are, without redaction.
 * Coding sessions often contain source code, credentials and other secrets, so don't use it for
 * sessions that handle data you can't send to Prefactor.
 *
 * ## Use it with the `pi` command
 *
 * ```bash
 * pi install npm:@prefactor/pi
 * ```
 *
 * Then run `/prefactor setup` inside pi. It signs you in to Prefactor in the browser, lets you
 * create an agent for pi or pick an existing one, and saves an agent-deployment token to
 * `~/.pi/agent/prefactor.json`. `/prefactor status` shows the connection, and
 * `/prefactor logout` deletes the saved credentials.
 *
 * The commands need dialogs, so in print and JSON modes set `PREFACTOR_API_URL`,
 * `PREFACTOR_API_TOKEN` and `PREFACTOR_AGENT_ID` instead.
 *
 * ## Use it in an agent built on pi's SDK
 *
 * Load the extension through `extensionFactories` with {@link prefactorExtension}:
 *
 * ```ts
 * import {
 *   type CreateAgentSessionRuntimeFactory,
 *   createAgentSessionFromServices,
 *   createAgentSessionRuntime,
 *   createAgentSessionServices,
 *   getAgentDir,
 *   SessionManager,
 * } from '@earendil-works/pi-coding-agent';
 * import { prefactorExtension } from '@prefactor/pi';
 *
 * const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
 *   const services = await createAgentSessionServices({
 *     cwd,
 *     resourceLoaderOptions: {
 *       extensionFactories: [
 *         prefactorExtension({
 *           apiUrl: 'https://app.prefactorai.com',
 *           apiToken: process.env.MY_PREFACTOR_TOKEN,
 *           agentVersion: '2.3.0',
 *         }),
 *       ],
 *     },
 *   });
 *   return {
 *     ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
 *     services,
 *     diagnostics: services.diagnostics,
 *   };
 * };
 *
 * const runtime = await createAgentSessionRuntime(createRuntime, {
 *   cwd: process.cwd(),
 *   agentDir: getAgentDir(),
 *   sessionManager: SessionManager.inMemory(),
 * });
 *
 * try {
 *   await runtime.session.bindExtensions({});
 *   await runtime.session.prompt('What files are in the current directory?');
 * } finally {
 *   await runtime.dispose();
 * }
 * ```
 *
 * Recording starts when `session.bindExtensions()` emits `session_start`, and the agent instance
 * finishes when `AgentSessionRuntime.dispose()` emits `session_shutdown`. Credentials passed in
 * code come first, then the environment variables, then the credentials file.
 *
 * To add your own spans, quality and alerts to the session's agent instance, use the
 * {@link PrefactorRecorder} that the `onSessionStart` option receives.
 *
 * The [package README](https://github.com/prefactordev/typescript-sdk/tree/main/packages/pi#readme)
 * covers credentials, every option and the span types the extension records.
 *
 * @module @prefactor/pi
 * @category Packages
 * @packageDocumentation
 */

import { prefactorExtension } from './extension.js';

export {
  type CredentialSource,
  type CredentialsFile,
  getCredentialsFilePath,
  type PrefactorCredentialOptions,
} from './credentials.js';
export { type PrefactorExtensionOptions, prefactorExtension } from './extension.js';
export type {
  PrefactorRecorder,
  PrefactorSpan,
  StartPrefactorSpanOptions,
} from './recorder.js';
export type { SchemaExtensions, ToolSchemaOptions } from './schema.js';

/** The pi extension, reading credentials from the environment or the credentials file. */
export default prefactorExtension();
