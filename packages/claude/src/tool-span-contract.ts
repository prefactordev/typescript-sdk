import { type JsonSchema, serializeValue } from '@prefactor/core';

export const GENERIC_OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
} as const satisfies JsonSchema;

const NORMALIZED_TOOL_OUTPUT_SCHEMA = {
  anyOf: [
    { type: 'null' },
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    GENERIC_OBJECT_SCHEMA,
    { type: 'array' },
  ],
} as const satisfies JsonSchema;

const TOKEN_USAGE_SCHEMA = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      properties: {
        prompt_tokens: { type: 'number' },
        completion_tokens: { type: 'number' },
        total_tokens: { type: 'number' },
      },
      required: ['prompt_tokens', 'completion_tokens', 'total_tokens'],
      additionalProperties: false,
    },
  ],
} as const satisfies JsonSchema;

const ERROR_SCHEMA = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      properties: {
        type: { type: 'string' },
        message: { type: 'string' },
        stacktrace: { type: 'string' },
      },
      required: ['type', 'message', 'stacktrace'],
      additionalProperties: false,
    },
  ],
} as const satisfies JsonSchema;

/**
 * Build the tool-call input payload for Claude spans.
 *
 * The tool name is intentionally duplicated under both `claude.tool.name` and
 * `toolName` for compatibility with existing span consumers. Optional fields
 * are omitted when `toolUseId` or `input` is undefined.
 *
 * @param params - Tool-call metadata and optional input payload.
 * @param params.toolName - Claude tool name to record in the span.
 * @param params.toolUseId - Optional Claude tool-use identifier.
 * @param params.input - Optional tool input payload, serialized for JSON-safe storage.
 * @returns A span input object suitable for `tracer.startSpan`.
 */
export function createToolSpanInputs({
  toolName,
  toolUseId,
  input,
}: {
  toolName: string;
  toolUseId?: string;
  input?: unknown;
}): Record<string, unknown> {
  return {
    'claude.tool.name': toolName,
    toolName,
    ...(toolUseId ? { toolUseId } : {}),
    ...(input !== undefined ? { input: serializeValue(input) } : {}),
  };
}

/**
 * Build the tool-call output payload for Claude spans.
 *
 * This delegates to `normalizeToolSpanOutput`, which converts `undefined` to
 * `null` before the payload is serialized for JSON-safe span storage.
 *
 * @param output - Raw tool output value from Claude.
 * @returns A span output object with normalized and serialized output data.
 */
export function createToolSpanOutputs(output: unknown): { output: unknown } {
  return {
    output: serializeValue(normalizeToolSpanOutput(output)),
  };
}

/**
 * Build the full JSON schema envelope used for Claude tool spans.
 *
 * The returned schema includes the standard span envelope fields plus
 * `inputs`, `outputs`, `metadata`, `token_usage`, and `error`. It enforces
 * required fields on the envelope and nested tool input/output objects while
 * leaving the top-level `metadata` object open via `additionalProperties`.
 *
 * @param inputSchema - JSON schema describing the tool-specific `input` payload.
 * @returns The complete tool span schema used in agent normalization.
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
          'claude.tool.name': { type: 'string' },
          toolName: { type: 'string' },
          toolUseId: { type: 'string' },
          input: inputSchema,
        },
        required: ['claude.tool.name', 'toolName'],
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

function normalizeToolSpanOutput(output: unknown): unknown {
  if (output === undefined) {
    return null;
  }

  return output;
}
