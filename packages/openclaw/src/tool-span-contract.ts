// Define JsonSchema type locally since @prefactor/core may not export it in dist
type JsonSchema = Record<string, unknown>;

/**
 * Generic object schema for flexible metadata.
 */
export const GENERIC_OBJECT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: true,
} satisfies JsonSchema;

/**
 * Schema for normalized tool outputs (supports various types).
 */
const NORMALIZED_TOOL_OUTPUT_SCHEMA = {
  anyOf: [
    { type: 'null' as const },
    { type: 'string' as const },
    { type: 'number' as const },
    { type: 'boolean' as const },
    GENERIC_OBJECT_SCHEMA,
    { type: 'array' as const },
  ],
} as const satisfies JsonSchema;

/**
 * Schema for token usage information.
 */
const TOKEN_USAGE_SCHEMA = {
  anyOf: [
    { type: 'null' as const },
    {
      type: 'object' as const,
      properties: {
        prompt_tokens: { type: 'number' as const },
        completion_tokens: { type: 'number' as const },
        total_tokens: { type: 'number' as const },
      },
      required: ['prompt_tokens', 'completion_tokens', 'total_tokens'],
      additionalProperties: false,
    },
  ],
} as const satisfies JsonSchema;

/**
 * Schema for error information.
 */
const ERROR_SCHEMA = {
  anyOf: [
    { type: 'null' as const },
    {
      type: 'object' as const,
      properties: {
        error_type: { type: 'string' as const },
        message: { type: 'string' as const },
        stacktrace: { type: 'string' as const },
      },
      required: ['error_type', 'message', 'stacktrace'],
      additionalProperties: false,
    },
  ],
} as const satisfies JsonSchema;

/**
 * Creates structured inputs for a tool call span.
 *
 * @param params - Tool call parameters
 * @returns Structured span inputs following OpenClaw tool-span-contract
 */
export function createToolSpanInputs({
  toolName,
  toolCallId,
  input,
}: {
  toolName: string;
  toolCallId?: string;
  input?: unknown;
}): Record<string, unknown> {
  return {
    'openclaw.tool.name': toolName,
    toolName,
    ...(toolCallId ? { toolCallId } : {}),
    ...(input !== undefined ? { input } : {}),
  };
}

/**
 * Creates structured outputs for a tool call span.
 *
 * @param output - Raw tool output
 * @returns Structured span outputs
 */
export function createToolSpanOutputs(output: unknown): { output: unknown } {
  return {
    output: normalizeToolSpanOutput(output),
  };
}

/**
 * Builds a complete JSON schema for a tool span.
 *
 * @param inputSchema - JSON Schema for the tool's input parameters
 * @returns Complete tool span schema
 */
export function buildToolSpanSchema(inputSchema: JsonSchema): JsonSchema {
  return {
    type: 'object',
    properties: {
      span_id: { type: 'string' },
      trace_id: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'string' },
      inputs: {
        type: 'object',
        properties: {
          'openclaw.tool.name': { type: 'string' },
          toolName: { type: 'string' },
          toolCallId: { type: 'string' },
          input: inputSchema,
        },
        required: ['openclaw.tool.name', 'toolName'],
        additionalProperties: false,
      },
      outputs: {
        type: 'object',
        properties: {
          output: NORMALIZED_TOOL_OUTPUT_SCHEMA,
        },
        required: ['output'],
        additionalProperties: false,
      },
      metadata: GENERIC_OBJECT_SCHEMA,
      token_usage: TOKEN_USAGE_SCHEMA,
      error: ERROR_SCHEMA,
    },
    required: ['span_id', 'trace_id', 'name', 'status', 'inputs', 'outputs', 'metadata'],
    additionalProperties: false,
  };
}

/**
 * Normalizes tool output to a consistent format.
 * - Returns null for undefined
 * - Extracts text value from { type: 'text', value: string } objects
 * - Passes through other values as-is
 *
 * @param output - Raw tool output
 * @returns Normalized output
 */
function normalizeToolSpanOutput(output: unknown): unknown {
  if (output === undefined) {
    return null;
  }

  // Handle OpenClaw text result objects
  if (
    typeof output === 'object' &&
    output !== null &&
    (output as { type?: unknown }).type === 'text' &&
    typeof (output as { value?: unknown }).value === 'string'
  ) {
    return (output as { value: string }).value;
  }

  // Handle simple string results (common in tool calls)
  if (typeof output === 'string') {
    return output;
  }

  return output;
}

/**
 * Creates a tool span result payload for finishing a span.
 *
 * @param output - Tool output
 * @param isError - Whether the tool execution resulted in an error
 * @returns Result payload for span finish
 */
export function createToolSpanResultPayload(
  output: unknown,
  isError: boolean
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    output: normalizeToolSpanOutput(output),
  };

  if (isError) {
    result.isError = true;
  }

  return result;
}
