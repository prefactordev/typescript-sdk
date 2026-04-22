/**
 * LiveKit Agents integration for Prefactor observability. Provides event-driven tracing for
 * `voice.AgentSession` lifecycle events, user and assistant turns, tool executions, and
 * LiveKit session usage updates through the core provider API.
 *
 * ## Quick Start
 *
 * ```ts
 * import { init } from '@prefactor/core';
 * import { PrefactorLiveKit } from '@prefactor/livekit';
 *
 * const prefactor = init({
 *   provider: new PrefactorLiveKit(),
 *   httpConfig: {
 *     apiUrl: process.env.PREFACTOR_API_URL!,
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *     agentIdentifier: 'v1.0.0',
 *   },
 * });
 *
 * const { createSessionTracer } = prefactor.getMiddleware();
 * const sessionTracer = createSessionTracer();
 *
 * await sessionTracer.attach(session);
 * await sessionTracer.close();
 * ```
 *
 * @module @prefactor/livekit
 * @category Packages
 * @packageDocumentation
 */

export { PrefactorLiveKit } from './provider.js';
export {
  DEFAULT_LIVEKIT_AGENT_SCHEMA,
  LIVEKIT_ASSISTANT_TURN_SCHEMA,
  LIVEKIT_ERROR_SCHEMA,
  LIVEKIT_LLM_SCHEMA,
  LIVEKIT_SESSION_SCHEMA,
  LIVEKIT_STATE_SCHEMA,
  LIVEKIT_STT_SCHEMA,
  LIVEKIT_TOOL_SCHEMA,
  LIVEKIT_TTS_SCHEMA,
  LIVEKIT_USER_TURN_SCHEMA,
  normalizeAgentSchema,
} from './schema.js';
export { PrefactorLiveKitSession } from './session.js';
export type { LiveKitMiddleware, LiveKitToolSchemaConfig } from './types.js';
