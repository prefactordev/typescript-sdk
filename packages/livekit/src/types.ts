import type { voice } from '@livekit/agents';
import type { JsonSchema, ToolSchemaConfig } from '@prefactor/core';
import type { PrefactorLiveKitSession } from './session.js';

export type LiveKitToolSchemaConfig = ToolSchemaConfig;

export interface LiveKitMiddleware {
  createSessionTracer(): PrefactorLiveKitSession;
}

export type LiveKitAgentSession = voice.AgentSession<unknown>;

export type LiveKitVoiceNamespace = typeof voice;

export type { JsonSchema };
