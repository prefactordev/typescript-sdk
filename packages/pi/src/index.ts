/**
 * pi coding agent extension for Prefactor observability. Records each pi session as a Prefactor
 * agent instance, as a conversation of user turns, assistant turns, LLM calls and tool executions.
 *
 * Install it into pi with `pi install npm:@prefactor/pi`, or load it in code through pi's
 * `extensionFactories`. See the package README for setup.
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
