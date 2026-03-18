import { normalizeAgentToolSchemas, resolveMappedSpanType } from '@prefactor/core';
import { buildToolSpanSchema, GENERIC_OBJECT_SCHEMA } from './tool-span-contract.js';

interface NormalizedLangChainSchemaData {
  agentSchema: Record<string, unknown>;
  toolSpanTypes?: Record<string, string>;
}

export const DEFAULT_LANGCHAIN_AGENT_SCHEMA = {
  external_identifier: 'langchain-schema',
  span_schemas: {
    'langchain:agent': { type: 'object', additionalProperties: true },
    'langchain:llm': { type: 'object', additionalProperties: true },
    'langchain:tool': { type: 'object', additionalProperties: true },
    'langchain:chain': { type: 'object', additionalProperties: true },
  },
  span_result_schemas: {
    'langchain:agent': { type: 'object', additionalProperties: true },
    'langchain:llm': { type: 'object', additionalProperties: true },
    'langchain:tool': { type: 'object', additionalProperties: true },
    'langchain:chain': { type: 'object', additionalProperties: true },
  },
} as const satisfies Record<string, unknown>;

export function normalizeAgentSchema(
  agentSchema: Record<string, unknown> | undefined
): NormalizedLangChainSchemaData {
  const normalizedToolSchemas = normalizeAgentToolSchemas(agentSchema, {
    defaultAgentSchema: DEFAULT_LANGCHAIN_AGENT_SCHEMA,
    providerName: 'langchain',
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
  return resolveMappedSpanType(toolName, toolSpanTypes, 'langchain:tool');
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

  for (const { spanType, inputSchema } of Object.values(toolSchemas)) {
    if (!spanSchemas[spanType]) {
      spanSchemas[spanType] = buildToolSpanSchema(inputSchema);
    }
    if (!spanResultSchemas[spanType]) {
      spanResultSchemas[spanType] = GENERIC_OBJECT_SCHEMA;
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
