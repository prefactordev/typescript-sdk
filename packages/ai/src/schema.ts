import { buildToolSpanSchema, GENERIC_OBJECT_SCHEMA } from './tool-span-contract.js';
import type { JsonSchema, ToolSchemaConfig } from './types.js';

interface NormalizedAISchemaData {
  agentSchema: Record<string, unknown>;
  toolSpanTypes?: Record<string, string>;
}

export const DEFAULT_AI_AGENT_SCHEMA = {
  external_identifier: 'ai-sdk-schema',
  span_schemas: {
    'ai-sdk:agent': { type: 'object', additionalProperties: true },
    'ai-sdk:llm': { type: 'object', additionalProperties: true },
    'ai-sdk:tool': { type: 'object', additionalProperties: true },
  },
  span_result_schemas: {
    'ai-sdk:agent': { type: 'object', additionalProperties: true },
    'ai-sdk:llm': { type: 'object', additionalProperties: true },
    'ai-sdk:tool': { type: 'object', additionalProperties: true },
  },
} as const satisfies Record<string, unknown>;

export function normalizeAgentSchema(
  agentSchema: Record<string, unknown> | undefined
): NormalizedAISchemaData {
  const toolSchemas = extractToolSchemas(agentSchema);
  return {
    agentSchema: buildAgentSchema(agentSchema, toolSchemas),
    toolSpanTypes: buildToolSpanTypes(toolSchemas),
  };
}

export function resolveToolSpanType(
  toolName: string,
  toolSpanTypes: Record<string, string> | undefined
): string {
  return toolSpanTypes?.[toolName] ?? 'ai-sdk:tool';
}

function buildAgentSchema(
  baseSchema: Record<string, unknown> | undefined,
  toolSchemas: Record<string, ToolSchemaConfig> | undefined
): Record<string, unknown> {
  const base = mergeWithDefaultAgentSchema(stripToolSchemas(baseSchema));
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

function extractToolSchemas(
  agentSchema: Record<string, unknown> | undefined
): Record<string, ToolSchemaConfig> | undefined {
  const rawToolSchemas = getRawToolSchemas(agentSchema);
  if (!rawToolSchemas) {
    return undefined;
  }

  const toolSchemas: Record<string, ToolSchemaConfig> = {};
  const toolBySpanType = new Map<string, string>();
  for (const [toolName, rawConfig] of Object.entries(rawToolSchemas)) {
    toolSchemas[toolName] = parseToolSchemaConfig(toolName, rawConfig, toolBySpanType);
  }

  return Object.keys(toolSchemas).length > 0 ? toolSchemas : undefined;
}

function getRawToolSchemas(
  agentSchema: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!agentSchema || typeof agentSchema !== 'object' || Array.isArray(agentSchema)) {
    return undefined;
  }

  const rawToolSchemas = (agentSchema as { toolSchemas?: unknown }).toolSchemas;
  if (rawToolSchemas === undefined) {
    return undefined;
  }

  if (!rawToolSchemas || typeof rawToolSchemas !== 'object' || Array.isArray(rawToolSchemas)) {
    throw new Error('Invalid agentSchema.toolSchemas: expected an object keyed by tool name.');
  }

  return rawToolSchemas as Record<string, unknown>;
}

function parseToolSchemaConfig(
  toolName: string,
  rawConfig: unknown,
  toolBySpanType: Map<string, string>
): ToolSchemaConfig {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new Error(
      `Invalid agentSchema.toolSchemas.${toolName}: expected an object with spanType and inputSchema.`
    );
  }

  const config = rawConfig as {
    spanType?: unknown;
    inputSchema?: unknown;
  };

  if (typeof config.spanType !== 'string') {
    throw new Error(
      `Invalid agentSchema.toolSchemas.${toolName}.spanType: expected a non-empty string.`
    );
  }

  const inputSchema = assertValidInputSchema(toolName, config.inputSchema);
  const normalizedSpanType = normalizeUniqueToolSpanType(toolName, config.spanType, toolBySpanType);
  return {
    spanType: normalizedSpanType,
    inputSchema,
  };
}

function assertValidInputSchema(toolName: string, inputSchema: unknown): JsonSchema {
  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    throw new Error(`Invalid agentSchema.toolSchemas.${toolName}.inputSchema: expected an object.`);
  }

  return inputSchema as JsonSchema;
}

function normalizeUniqueToolSpanType(
  toolName: string,
  spanType: string,
  toolBySpanType: Map<string, string>
): string {
  const normalizedSpanType = normalizeToolSpanType(spanType, toolName);
  const conflictingTool = toolBySpanType.get(normalizedSpanType);
  if (conflictingTool && conflictingTool !== toolName) {
    throw new Error(
      `Invalid agentSchema.toolSchemas.${toolName}.spanType: normalized span type "${normalizedSpanType}" conflicts with "${conflictingTool}".`
    );
  }

  toolBySpanType.set(normalizedSpanType, toolName);
  return normalizedSpanType;
}

function buildToolSpanTypes(
  toolSchemas: Record<string, ToolSchemaConfig> | undefined
): Record<string, string> | undefined {
  if (!toolSchemas) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(toolSchemas).map(([toolName, config]) => [toolName, config.spanType])
  );
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function stripToolSchemas(
  baseSchema: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!baseSchema || typeof baseSchema !== 'object' || Array.isArray(baseSchema)) {
    return baseSchema;
  }

  const { toolSchemas: _, ...rest } = baseSchema as Record<string, unknown> & {
    toolSchemas?: unknown;
  };

  return rest;
}

function mergeWithDefaultAgentSchema(
  baseSchema: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!baseSchema) {
    return DEFAULT_AI_AGENT_SCHEMA;
  }

  return {
    ...DEFAULT_AI_AGENT_SCHEMA,
    ...baseSchema,
    span_schemas: {
      ...cloneRecord(DEFAULT_AI_AGENT_SCHEMA.span_schemas),
      ...cloneRecord(baseSchema.span_schemas),
    },
    span_result_schemas: {
      ...cloneRecord(DEFAULT_AI_AGENT_SCHEMA.span_result_schemas),
      ...cloneRecord(baseSchema.span_result_schemas),
    },
  };
}

function normalizeToolSpanType(spanType: string, toolName: string): string {
  const trimmedSpanType = spanType.trim();
  if (trimmedSpanType.length === 0) {
    throw new Error(
      `Invalid agentSchema.toolSchemas.${toolName}.spanType: expected a non-empty string.`
    );
  }

  if (trimmedSpanType.startsWith('ai-sdk:tool:')) {
    const suffix = trimmedSpanType.slice('ai-sdk:tool:'.length).replace(/^:+/, '');
    if (suffix.length === 0) {
      throw new Error(
        `Invalid agentSchema.toolSchemas.${toolName}.spanType: expected a non-empty suffix after normalization.`
      );
    }
    return `ai-sdk:tool:${suffix}`;
  }

  let suffix = trimmedSpanType;
  if (suffix.startsWith('ai-sdk:')) {
    suffix = suffix.slice('ai-sdk:'.length);
  }
  if (suffix.startsWith('tool:')) {
    suffix = suffix.slice('tool:'.length);
  }

  suffix = suffix.replace(/^:+/, '');
  if (suffix.length === 0) {
    throw new Error(
      `Invalid agentSchema.toolSchemas.${toolName}.spanType: expected a non-empty suffix after normalization.`
    );
  }

  return `ai-sdk:tool:${suffix}`;
}
