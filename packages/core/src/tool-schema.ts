import { getLogger } from './utils/logging.js';

export type JsonSchema = Record<string, unknown>;

export interface ToolSchemaConfig {
  spanType: string;
  inputSchema: JsonSchema;
}

export interface NormalizedAgentToolSchemas {
  agentSchema: Record<string, unknown>;
  toolSchemas?: Record<string, ToolSchemaConfig>;
  toolSpanTypes?: Record<string, string>;
}

const logger = getLogger('tool-schema');

export function normalizeAgentToolSchemas(
  agentSchema: Record<string, unknown> | undefined,
  {
    defaultAgentSchema,
    providerName,
  }: {
    defaultAgentSchema: Record<string, unknown>;
    providerName: string;
  }
): NormalizedAgentToolSchemas {
  const toolSchemas = extractToolSchemas(agentSchema, providerName);
  return {
    agentSchema: mergeWithDefaultAgentSchema(stripToolSchemas(agentSchema), defaultAgentSchema),
    toolSchemas,
    toolSpanTypes: buildToolSpanTypes(toolSchemas),
  };
}

export function resolveMappedSpanType(
  toolName: string,
  toolSpanTypes: Record<string, string> | undefined,
  defaultSpanType: string
): string {
  return toolSpanTypes?.[toolName] ?? defaultSpanType;
}

function extractToolSchemas(
  agentSchema: Record<string, unknown> | undefined,
  providerName: string
): Record<string, ToolSchemaConfig> | undefined {
  const rawToolSchemas = getRawToolSchemas(agentSchema);
  if (!rawToolSchemas) {
    return undefined;
  }

  const toolSchemas: Record<string, ToolSchemaConfig> = {};
  const toolBySpanType = new Map<string, string>();
  for (const [toolName, rawConfig] of Object.entries(rawToolSchemas)) {
    const parsedToolSchema = parseToolSchemaConfig(
      toolName,
      rawConfig,
      providerName,
      toolBySpanType
    );
    if (!parsedToolSchema) {
      continue;
    }

    toolSchemas[toolName] = parsedToolSchema;
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
    logger.warn('Ignoring invalid agentSchema.toolSchemas: expected an object keyed by tool name.');
    return undefined;
  }

  return rawToolSchemas as Record<string, unknown>;
}

function parseToolSchemaConfig(
  toolName: string,
  rawConfig: unknown,
  providerName: string,
  toolBySpanType: Map<string, string>
): ToolSchemaConfig | undefined {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    logger.warn(
      `Invalid agentSchema.toolSchemas.${toolName}: expected an object with spanType and inputSchema.`
    );
    return undefined;
  }

  const config = rawConfig as {
    spanType?: unknown;
    inputSchema?: unknown;
  };

  if (typeof config.spanType !== 'string') {
    logger.warn(
      `Invalid agentSchema.toolSchemas.${toolName}.spanType: expected a non-empty string.`
    );
    return undefined;
  }

  const inputSchema = assertValidInputSchema(toolName, config.inputSchema);
  if (!inputSchema) {
    return undefined;
  }

  const normalizedSpanType = normalizeUniqueToolSpanType(
    toolName,
    config.spanType,
    providerName,
    toolBySpanType
  );
  if (!normalizedSpanType) {
    return undefined;
  }

  return {
    spanType: normalizedSpanType,
    inputSchema,
  };
}

function assertValidInputSchema(toolName: string, inputSchema: unknown): JsonSchema | undefined {
  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    logger.warn(`Invalid agentSchema.toolSchemas.${toolName}.inputSchema: expected an object.`);
    return undefined;
  }

  return inputSchema as JsonSchema;
}

function normalizeUniqueToolSpanType(
  toolName: string,
  spanType: string,
  providerName: string,
  toolBySpanType: Map<string, string>
): string | undefined {
  const normalizedSpanType = normalizeToolSpanType(spanType, toolName, providerName);
  if (!normalizedSpanType) {
    return undefined;
  }

  const conflictingTool = toolBySpanType.get(normalizedSpanType);
  if (conflictingTool && conflictingTool !== toolName) {
    logger.warn(
      `Invalid agentSchema.toolSchemas.${toolName}.spanType: normalized span type "${normalizedSpanType}" conflicts with "${conflictingTool}".`
    );
    return undefined;
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
  baseSchema: Record<string, unknown> | undefined,
  defaultAgentSchema: Record<string, unknown>
): Record<string, unknown> {
  if (!baseSchema) {
    return defaultAgentSchema;
  }

  return {
    ...defaultAgentSchema,
    ...baseSchema,
    span_schemas: {
      ...cloneRecord(defaultAgentSchema.span_schemas),
      ...cloneRecord(baseSchema.span_schemas),
    },
    span_result_schemas: {
      ...cloneRecord(defaultAgentSchema.span_result_schemas),
      ...cloneRecord(baseSchema.span_result_schemas),
    },
  };
}

function normalizeToolSpanType(
  spanType: string,
  toolName: string,
  providerName: string
): string | undefined {
  const trimmedSpanType = spanType.trim();
  if (trimmedSpanType.length === 0) {
    logger.warn(
      `Invalid agentSchema.toolSchemas.${toolName}.spanType: expected a non-empty string.`
    );
    return undefined;
  }

  const providerToolPrefix = `${providerName}:tool:`;
  if (trimmedSpanType.startsWith(providerToolPrefix)) {
    const suffix = trimmedSpanType.slice(providerToolPrefix.length).replace(/^:+/, '');
    if (suffix.length === 0) {
      logger.warn(
        `Invalid agentSchema.toolSchemas.${toolName}.spanType: expected a non-empty suffix after normalization.`
      );
      return undefined;
    }

    return `${providerName}:tool:${suffix}`;
  }

  let suffix = trimmedSpanType;
  if (suffix.startsWith(`${providerName}:`)) {
    suffix = suffix.slice(`${providerName}:`.length);
  }
  if (suffix.startsWith('tool:')) {
    suffix = suffix.slice('tool:'.length);
  }

  suffix = suffix.replace(/^:+/, '');
  if (suffix.length === 0) {
    logger.warn(
      `Invalid agentSchema.toolSchemas.${toolName}.spanType: expected a non-empty suffix after normalization.`
    );
    return undefined;
  }

  return `${providerName}:tool:${suffix}`;
}
