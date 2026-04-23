import { normalizeAgentToolSchemas, resolveMappedSpanType } from '@prefactor/core';
import type { JsonSchema } from './types.js';

interface NormalizedLiveKitSchemaData {
  agentSchema: Record<string, unknown>;
  toolSpanTypes?: Record<string, string>;
}

export const GENERIC_OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
} as const satisfies JsonSchema;

export const LIVEKIT_SESSION_SCHEMA = {
  'prefactor:template':
    'Session {{ status | default: "completed" }}{% if conversation.userMessages %}: {{ conversation.userMessages }} user, {{ conversation.assistantMessages | default: 0 }} assistant{% endif %}{% if conversation.functionCalls %}, {{ conversation.functionCalls }} tool calls{% endif %}{% if metadata.closeReason %} ({{ metadata.closeReason }}){% endif %}',
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', const: 'livekit:session' },
    agentName: { type: 'string' },
    sessionClass: { type: 'string' },
    agentClass: { type: 'string' },
    metadata: GENERIC_OBJECT_SCHEMA,
    startedAt: { type: 'number' },
    finishedAt: { type: 'number' },
  },
} as const satisfies JsonSchema;

export const LIVEKIT_SESSION_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    usage: GENERIC_OBJECT_SCHEMA,
    conversation: GENERIC_OBJECT_SCHEMA,
    error: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_USER_TURN_SCHEMA = {
  'prefactor:template':
    '{% if transcript %}User: {{ transcript }}{% else %}User turn{% endif %}{% if language %} ({{ language }}){% endif %}{% if status == "cancelled" %} -> cancelled{% endif %}',
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', const: 'livekit:user_turn' },
    turnIndex: { type: 'integer' },
    createdAt: { type: 'number' },
    startedAt: { type: 'number' },
    metadata: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_USER_TURN_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    transcript: { type: 'string' },
    speakerId: { type: 'string' },
    language: { type: 'string' },
    isFinal: { type: 'boolean' },
    finishedAt: { type: 'number' },
    metrics: GENERIC_OBJECT_SCHEMA,
    metadata: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_ASSISTANT_TURN_SCHEMA = {
  'prefactor:template':
    '{% if outputs.message.content %}Assistant: {{ outputs.message.content }}{% elsif outputs.message.textContent %}Assistant: {{ outputs.message.textContent }}{% elsif status == "cancelled" %}Assistant turn cancelled{% else %}Assistant turn {{ status | default: "completed" }}{% endif %}',
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', const: 'livekit:assistant_turn' },
    turnIndex: { type: 'integer' },
    source: { type: 'string' },
    userInitiated: { type: 'boolean' },
    createdAt: { type: 'number' },
    startedAt: { type: 'number' },
    metadata: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_ASSISTANT_TURN_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    outputs: GENERIC_OBJECT_SCHEMA,
    interrupted: { type: 'boolean' },
    finishedAt: { type: 'number' },
    metrics: GENERIC_OBJECT_SCHEMA,
    error: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_TOOL_SCHEMA = {
  'prefactor:template':
    'Tool {{ outputs.name | default: "call" }}{% if status %} -> {{ status }}{% endif %}{% if isError %} (error){% endif %}',
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', const: 'livekit:tool' },
    toolName: { type: 'string' },
    callId: { type: 'string' },
    groupId: { type: 'string' },
    inputs: GENERIC_OBJECT_SCHEMA,
    createdAt: { type: 'number' },
    metadata: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_TOOL_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    outputs: GENERIC_OBJECT_SCHEMA,
    isError: { type: 'boolean' },
    error: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_LLM_SCHEMA = {
  'prefactor:template':
    'LLM {{ metrics.metadata.modelName | default: "model" }}{% if metrics.totalTokens %}: {{ metrics.totalTokens }} tokens{% endif %}{% if status %} -> {{ status }}{% endif %}',
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', const: 'livekit:llm' },
    turnIndex: { type: 'integer' },
    requestId: { type: 'string' },
    label: { type: 'string' },
    modelName: { type: 'string' },
    provider: { type: 'string' },
    timestamp: { type: 'number' },
    metadata: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_LLM_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    metrics: GENERIC_OBJECT_SCHEMA,
    error: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_STT_SCHEMA = {
  'prefactor:template':
    'STT {{ metrics.metadata.modelName | default: "speech-to-text" }}{% if metrics.audioDurationMs %}: {{ metrics.audioDurationMs }} ms audio{% endif %}{% if status %} -> {{ status }}{% endif %}',
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', const: 'livekit:stt' },
    requestId: { type: 'string' },
    label: { type: 'string' },
    modelName: { type: 'string' },
    provider: { type: 'string' },
    timestamp: { type: 'number' },
    metadata: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_STT_RESULT_SCHEMA = LIVEKIT_LLM_RESULT_SCHEMA;

export const LIVEKIT_TTS_SCHEMA = {
  'prefactor:template':
    'TTS {{ metrics.metadata.modelName | default: "text-to-speech" }}{% if metrics.charactersCount %}: {{ metrics.charactersCount }} chars{% endif %}{% if status %} -> {{ status }}{% endif %}',
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', const: 'livekit:tts' },
    requestId: { type: 'string' },
    label: { type: 'string' },
    modelName: { type: 'string' },
    provider: { type: 'string' },
    timestamp: { type: 'number' },
    metadata: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_TTS_RESULT_SCHEMA = LIVEKIT_LLM_RESULT_SCHEMA;

export const LIVEKIT_STATE_SCHEMA = {
  'prefactor:template': 'State change{% if status %} -> {{ status }}{% endif %}',
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', const: 'livekit:state' },
    actor: { type: 'string' },
    oldState: { type: 'string' },
    newState: { type: 'string' },
    eventType: { type: 'string' },
    createdAt: { type: 'number' },
    metadata: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_STATE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    metrics: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_ERROR_SCHEMA = {
  'prefactor:template':
    'LiveKit error{% if error.errorType %} {{ error.errorType }}{% endif %}{% if error.message %}: {{ error.message }}{% endif %}',
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', const: 'livekit:error' },
    source: { type: 'string' },
    errorType: { type: 'string' },
    message: { type: 'string' },
    createdAt: { type: 'number' },
    metadata: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const LIVEKIT_ERROR_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    error: GENERIC_OBJECT_SCHEMA,
  },
} as const satisfies JsonSchema;

export const DEFAULT_LIVEKIT_AGENT_SCHEMA = {
  external_identifier: 'livekit-schema',
  span_schemas: {
    'livekit:session': LIVEKIT_SESSION_SCHEMA,
    'livekit:user_turn': LIVEKIT_USER_TURN_SCHEMA,
    'livekit:assistant_turn': LIVEKIT_ASSISTANT_TURN_SCHEMA,
    'livekit:tool': LIVEKIT_TOOL_SCHEMA,
    'livekit:llm': LIVEKIT_LLM_SCHEMA,
    'livekit:stt': LIVEKIT_STT_SCHEMA,
    'livekit:tts': LIVEKIT_TTS_SCHEMA,
    'livekit:state': LIVEKIT_STATE_SCHEMA,
    'livekit:error': LIVEKIT_ERROR_SCHEMA,
  },
  span_result_schemas: {
    'livekit:session': LIVEKIT_SESSION_RESULT_SCHEMA,
    'livekit:user_turn': LIVEKIT_USER_TURN_RESULT_SCHEMA,
    'livekit:assistant_turn': LIVEKIT_ASSISTANT_TURN_RESULT_SCHEMA,
    'livekit:tool': LIVEKIT_TOOL_RESULT_SCHEMA,
    'livekit:llm': LIVEKIT_LLM_RESULT_SCHEMA,
    'livekit:stt': LIVEKIT_STT_RESULT_SCHEMA,
    'livekit:tts': LIVEKIT_TTS_RESULT_SCHEMA,
    'livekit:state': LIVEKIT_STATE_RESULT_SCHEMA,
    'livekit:error': LIVEKIT_ERROR_RESULT_SCHEMA,
  },
} as const satisfies Record<string, unknown>;

export function normalizeAgentSchema(
  agentSchema: Record<string, unknown> | undefined
): NormalizedLiveKitSchemaData {
  const normalizedToolSchemas = normalizeAgentToolSchemas(agentSchema, {
    defaultAgentSchema: DEFAULT_LIVEKIT_AGENT_SCHEMA,
    providerName: 'livekit',
  });

  return {
    agentSchema: buildAgentSchema(normalizedToolSchemas),
    toolSpanTypes: normalizedToolSchemas.toolSpanTypes,
  };
}

export function resolveToolSpanType(
  toolName: string,
  toolSpanTypes: Record<string, string> | undefined
): string {
  return resolveMappedSpanType(toolName, toolSpanTypes, 'livekit:tool');
}

function buildAgentSchema(
  normalizedToolSchemas: ReturnType<typeof normalizeAgentToolSchemas>
): Record<string, unknown> {
  const base = normalizedToolSchemas.agentSchema;
  const toolSchemas = normalizedToolSchemas.toolSchemas;
  if (!toolSchemas) {
    return base;
  }

  const spanSchemas = cloneRecord(base.span_schemas);
  const spanResultSchemas = cloneRecord(base.span_result_schemas);

  for (const { spanType } of Object.values(toolSchemas)) {
    if (!spanSchemas[spanType]) {
      spanSchemas[spanType] = LIVEKIT_TOOL_SCHEMA;
    }
    if (!spanResultSchemas[spanType]) {
      spanResultSchemas[spanType] = LIVEKIT_TOOL_RESULT_SCHEMA;
    }
  }

  return {
    ...base,
    span_schemas: spanSchemas,
    span_result_schemas: spanResultSchemas,
  };
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}
