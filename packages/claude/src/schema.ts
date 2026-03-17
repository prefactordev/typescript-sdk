import { normalizeAgentToolSchemas, resolveMappedSpanType } from '@prefactor/core';
import { buildToolSpanSchema, GENERIC_OBJECT_SCHEMA } from './tool-span-contract.js';

interface NormalizedClaudeSchemaData {
  agentSchema: Record<string, unknown>;
  toolSpanTypes?: Record<string, string>;
}

export const DEFAULT_CLAUDE_AGENT_SCHEMA = {
  external_identifier: 'claude-schema',
  span_schemas: {
    'claude:agent': { type: 'object', additionalProperties: true },
    'claude:llm': { type: 'object', additionalProperties: true },
    'claude:tool': { type: 'object', additionalProperties: true },
    'claude:subagent': { type: 'object', additionalProperties: true },
  },
  span_result_schemas: {
    'claude:agent': { type: 'object', additionalProperties: true },
    'claude:llm': { type: 'object', additionalProperties: true },
    'claude:tool': { type: 'object', additionalProperties: true },
    'claude:subagent': { type: 'object', additionalProperties: true },
  },
} as const satisfies Record<string, unknown>;

export function normalizeAgentSchema(
  agentSchema: Record<string, unknown> | undefined
): NormalizedClaudeSchemaData {
  const normalizedToolSchemas = normalizeAgentToolSchemas(agentSchema, {
    defaultAgentSchema: DEFAULT_CLAUDE_AGENT_SCHEMA,
    providerName: 'claude',
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
  return resolveMappedSpanType(toolName, toolSpanTypes, 'claude:tool');
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
