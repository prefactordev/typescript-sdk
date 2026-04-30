import { normalizeAgentToolSchemas, resolveMappedSpanType } from '@prefactor/core';
import type { JsonSchema } from './types.js';

interface NormalizedLiveKitSchemaData {
  agentSchema: Record<string, unknown>;
  toolSpanTypes?: Record<string, string>;
}

export interface LiveKitSpanTypeSchema {
  name: string;
  params_schema: JsonSchema;
  result_schema?: JsonSchema;
  title?: string;
  description?: string;
  template?: string;
  data_risk?: Record<string, unknown>;
}

const DEFAULT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
} as const satisfies JsonSchema;

export const GENERIC_OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
} as const satisfies JsonSchema;

const LIVEKIT_SESSION_TEMPLATE =
  'Session {{ status }}{% if conversation.userMessages %}: {{ conversation.userMessages }} user, {{ conversation.assistantMessages }} assistant{% endif %}{% if conversation.functionCalls %}, {{ conversation.functionCalls }} tool calls{% endif %}{% if metadata.closeReason %} ({{ metadata.closeReason }}){% endif %}';
const LIVEKIT_USER_TURN_TEMPLATE =
  '{% if transcript %}User: {{ transcript }}{% else %}User turn{% endif %}{% if language %} ({{ language }}){% endif %}{% if status == "cancelled" %} -> cancelled{% endif %}';
const LIVEKIT_ASSISTANT_TURN_TEMPLATE =
  '{% if outputs.message.content %}Assistant: {{ outputs.message.content }}{% elsif outputs.message.textContent %}Assistant: {{ outputs.message.textContent }}{% elsif status == "cancelled" %}Assistant turn cancelled{% else %}Assistant turn {{ status }}{% endif %}';
const LIVEKIT_TOOL_TEMPLATE =
  'Tool {{ outputs.name }}{% if status %} -> {{ status }}{% endif %}{% if isError %} (error){% endif %}';
const LIVEKIT_LLM_TEMPLATE =
  'LLM {{ modelName }}{% if metrics.totalTokens %}: {{ metrics.totalTokens }} tokens{% endif %}{% if status %} -> {{ status }}{% endif %}';
const LIVEKIT_STT_TEMPLATE =
  'STT {{ modelName }}{% if metrics.audioDurationMs %}: {{ metrics.audioDurationMs }} ms audio{% endif %}{% if status %} -> {{ status }}{% endif %}';
const LIVEKIT_TTS_TEMPLATE =
  'TTS {{ modelName }}{% if metrics.charactersCount %}: {{ metrics.charactersCount }} chars{% endif %}{% if status %} -> {{ status }}{% endif %}';
const LIVEKIT_STATE_TEMPLATE = 'State change{% if status %} -> {{ status }}{% endif %}';
const LIVEKIT_ERROR_TEMPLATE =
  'LiveKit error{% if error.errorType %} {{ error.errorType }}{% endif %}{% if error.message %}: {{ error.message }}{% endif %}';

export const LIVEKIT_SESSION_SCHEMA = {
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
  span_type_schemas: [
    buildSpanTypeSchema('livekit:session', LIVEKIT_SESSION_TEMPLATE, LIVEKIT_SESSION_SCHEMA, {
      resultSchema: LIVEKIT_SESSION_RESULT_SCHEMA,
    }),
    buildSpanTypeSchema('livekit:user_turn', LIVEKIT_USER_TURN_TEMPLATE, LIVEKIT_USER_TURN_SCHEMA, {
      resultSchema: LIVEKIT_USER_TURN_RESULT_SCHEMA,
    }),
    buildSpanTypeSchema(
      'livekit:assistant_turn',
      LIVEKIT_ASSISTANT_TURN_TEMPLATE,
      LIVEKIT_ASSISTANT_TURN_SCHEMA,
      {
        resultSchema: LIVEKIT_ASSISTANT_TURN_RESULT_SCHEMA,
      }
    ),
    buildSpanTypeSchema('livekit:tool', LIVEKIT_TOOL_TEMPLATE, LIVEKIT_TOOL_SCHEMA, {
      resultSchema: LIVEKIT_TOOL_RESULT_SCHEMA,
    }),
    buildSpanTypeSchema('livekit:llm', LIVEKIT_LLM_TEMPLATE, LIVEKIT_LLM_SCHEMA, {
      resultSchema: LIVEKIT_LLM_RESULT_SCHEMA,
    }),
    buildSpanTypeSchema('livekit:stt', LIVEKIT_STT_TEMPLATE, LIVEKIT_STT_SCHEMA, {
      resultSchema: LIVEKIT_STT_RESULT_SCHEMA,
    }),
    buildSpanTypeSchema('livekit:tts', LIVEKIT_TTS_TEMPLATE, LIVEKIT_TTS_SCHEMA, {
      resultSchema: LIVEKIT_TTS_RESULT_SCHEMA,
    }),
    buildSpanTypeSchema('livekit:state', LIVEKIT_STATE_TEMPLATE, LIVEKIT_STATE_SCHEMA, {
      resultSchema: LIVEKIT_STATE_RESULT_SCHEMA,
    }),
    buildSpanTypeSchema('livekit:error', LIVEKIT_ERROR_TEMPLATE, LIVEKIT_ERROR_SCHEMA, {
      resultSchema: LIVEKIT_ERROR_RESULT_SCHEMA,
    }),
  ],
} as const satisfies Record<string, unknown>;

export function normalizeAgentSchema(
  agentSchema: Record<string, unknown> | undefined
): NormalizedLiveKitSchemaData {
  const normalizedTools = normalizeAgentToolSchemas(agentSchema ?? {}, {
    defaultAgentSchema: {},
    providerName: 'livekit',
  });

  const userSpanTypeSchemas = readSpanTypeSchemas(agentSchema?.span_type_schemas);
  const mergedSpanTypeSchemas = mergeSpanTypeSchemas(
    DEFAULT_LIVEKIT_AGENT_SCHEMA.span_type_schemas as unknown as LiveKitSpanTypeSchema[],
    userSpanTypeSchemas ?? []
  );
  const existingSpanTypeNames = new Set(mergedSpanTypeSchemas.map((schema) => schema.name));
  const customToolSpanTypeSchemas = buildCustomToolSpanTypeSchemas(
    normalizedTools.toolSchemas,
    existingSpanTypeNames
  );

  const {
    toolSchemas: _toolSchemas,
    span_type_schemas: _spanTypeSchemas,
    ...rest
  } = cloneRecord(agentSchema);

  return {
    agentSchema: {
      ...rest,
      span_type_schemas: [...mergedSpanTypeSchemas, ...customToolSpanTypeSchemas],
    },
    toolSpanTypes: normalizedTools.toolSpanTypes,
  };
}

export function resolveToolSpanType(
  toolName: string,
  toolSpanTypes: Record<string, string> | undefined
): string {
  return resolveMappedSpanType(toolName, toolSpanTypes, 'livekit:tool');
}

function buildSpanTypeSchema(
  name: string,
  template: string,
  paramsSchema: JsonSchema,
  {
    resultSchema,
    title,
    description,
    dataRisk,
  }: {
    resultSchema?: JsonSchema;
    title?: string;
    description?: string;
    dataRisk?: Record<string, unknown>;
  } = {}
): LiveKitSpanTypeSchema {
  return compactRecord({
    name,
    title,
    description,
    template,
    data_risk: dataRisk,
    params_schema: paramsSchema,
    result_schema: resultSchema,
  }) as unknown as LiveKitSpanTypeSchema;
}

function mergeSpanTypeSchemas(
  defaults: LiveKitSpanTypeSchema[],
  overrides: LiveKitSpanTypeSchema[]
): LiveKitSpanTypeSchema[] {
  const overrideMap = new Map(overrides.map((s) => [s.name, s]));
  const merged = defaults.map((s) => {
    const override = overrideMap.get(s.name);
    if (!override) {
      return s;
    }
    return override.result_schema ? override : { ...override, result_schema: s.result_schema };
  });
  const newEntries = overrides
    .filter((s) => !defaults.some((d) => d.name === s.name))
    .map((s) => (s.result_schema ? s : { ...s, result_schema: DEFAULT_RESULT_SCHEMA }));
  return [...merged, ...newEntries];
}

function buildCustomToolSpanTypeSchemas(
  toolSchemas: ReturnType<typeof normalizeAgentToolSchemas>['toolSchemas'],
  existingSpanTypeNames: Set<string>
): LiveKitSpanTypeSchema[] {
  if (!toolSchemas) return [];
  return Object.values(toolSchemas).flatMap(({ spanType }) => {
    if (existingSpanTypeNames.has(spanType)) {
      return [];
    }

    const properties = {
      ...cloneRecord(LIVEKIT_TOOL_SCHEMA.properties),
      type: { type: 'string', const: spanType },
    };
    const paramsSchema = { ...cloneRecord(LIVEKIT_TOOL_SCHEMA), properties } as JsonSchema;
    return [
      buildSpanTypeSchema(spanType, LIVEKIT_TOOL_TEMPLATE, paramsSchema, {
        resultSchema: LIVEKIT_TOOL_RESULT_SCHEMA,
      }),
    ];
  });
}

function readSpanTypeSchemas(value: unknown): LiveKitSpanTypeSchema[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const spanTypeSchemas = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const name = record.name;
    const paramsSchema = readJsonSchema(record.params_schema);
    if (typeof name !== 'string' || !paramsSchema) {
      return [];
    }

    return [
      compactRecord({
        name,
        title: readOptionalString(record.title),
        description: readOptionalString(record.description),
        template: readOptionalString(record.template),
        data_risk: readRecord(record.data_risk),
        params_schema: paramsSchema,
        result_schema: readJsonSchema(record.result_schema),
      }) as unknown as LiveKitSpanTypeSchema,
    ];
  });

  return spanTypeSchemas.length > 0 ? spanTypeSchemas : undefined;
}

function readJsonSchema(value: unknown): JsonSchema | undefined {
  const record = readRecord(value);
  return record ? (record as JsonSchema) : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
