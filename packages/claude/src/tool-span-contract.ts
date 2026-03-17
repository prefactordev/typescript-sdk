import type { JsonSchema } from '@prefactor/core';

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
        error_type: { type: 'string' },
        message: { type: 'string' },
        stacktrace: { type: 'string' },
      },
      required: ['error_type', 'message', 'stacktrace'],
      additionalProperties: false,
    },
  ],
} as const satisfies JsonSchema;

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
    ...(input !== undefined ? { input } : {}),
  };
}

export function createToolSpanOutputs(output: unknown): { output: unknown } {
  return {
    output: normalizeToolSpanOutput(output),
  };
}

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
