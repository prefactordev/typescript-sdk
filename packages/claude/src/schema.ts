import { normalizeAgentToolSchemas, resolveMappedSpanType } from '@prefactor/core';
import { buildToolSpanSchema, GENERIC_OBJECT_SCHEMA } from './tool-span-contract.js';

interface NormalizedClaudeSchemaData {
  agentSchema: Record<string, unknown>;
  toolSpanTypes?: Record<string, string>;
}

const toolSpanTypesBySchema = new WeakMap<Record<string, unknown>, Record<string, string>>();

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

/**
 * Normalize a Claude agent schema and attach any provider-specific tool span metadata.
 *
 * Tool schema normalization is delegated to core, then the resulting tool span
 * schemas are merged into Claude's default `span_schemas` and
 * `span_result_schemas`. The internal cache that backs
 * `getToolSpanTypesForAgentSchema` is keyed by the normalized agent schema
 * object identity, not by structural equality, so equivalent-looking objects
 * only share cached data when they are the exact same object reference.
 *
 * @param agentSchema - Optional raw agent schema provided by the caller.
 * @returns The normalized agent schema plus any extracted tool-to-span-type mapping.
 */
export function normalizeAgentSchema(
  agentSchema: Record<string, unknown> | undefined
): NormalizedClaudeSchemaData {
  const normalizedToolSchemas = normalizeAgentToolSchemas(agentSchema, {
    defaultAgentSchema: DEFAULT_CLAUDE_AGENT_SCHEMA,
    providerName: 'claude',
  });

  const normalizedAgentSchema = buildAgentSchema(normalizedToolSchemas);
  if (normalizedToolSchemas.toolSpanTypes) {
    toolSpanTypesBySchema.set(normalizedAgentSchema, normalizedToolSchemas.toolSpanTypes);
  }

  return {
    agentSchema: normalizedAgentSchema,
    toolSpanTypes: normalizedToolSchemas.toolSpanTypes,
  };
}

/**
 * Retrieve the cached tool span type mapping for a normalized agent schema.
 *
 * Lookups use object identity via a `WeakMap`, not structural equality, so
 * callers must pass the same normalized schema object returned by
 * `normalizeAgentSchema` to get a cache hit.
 *
 * @param agentSchema - Normalized agent schema object to query.
 * @returns The cached tool-to-span-type mapping, if one was stored for this exact object.
 */
export function getToolSpanTypesForAgentSchema(
  agentSchema: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!agentSchema) {
    return undefined;
  }

  return toolSpanTypesBySchema.get(agentSchema);
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
