import { describe, expect, test } from 'bun:test';
import {
  buildToolSpanSchema,
  createToolSpanInputs,
  createToolSpanOutputs,
} from '../src/tool-span-contract.js';

describe('tool-span-contract', () => {
  test('createToolSpanInputs includes tool name and optional fields', () => {
    expect(
      createToolSpanInputs({
        toolName: 'Read',
        toolUseId: 'tool-use-1',
        input: { file_path: '/tmp/file.ts' },
      })
    ).toEqual({
      'claude.tool.name': 'Read',
      toolName: 'Read',
      toolUseId: 'tool-use-1',
      input: { file_path: '/tmp/file.ts' },
    });
  });

  test('createToolSpanInputs serializes non-JSON-safe values and truncates long strings', () => {
    const inputs = createToolSpanInputs({
      toolName: 'Bash',
      input: {
        handler: () => 'ok',
        longText: 'a'.repeat(10005),
      },
    });

    expect(inputs['claude.tool.name']).toBe('Bash');
    expect(inputs.toolName).toBe('Bash');
    expect(inputs.input).toEqual({
      handler: expect.any(String),
      longText: `${'a'.repeat(10000)}... [truncated]`,
    });
  });

  test('createToolSpanOutputs normalizes undefined to null', () => {
    expect(createToolSpanOutputs(undefined)).toEqual({ output: null });
  });

  test('createToolSpanOutputs serializes non-JSON-safe values and truncates long strings', () => {
    expect(
      createToolSpanOutputs({
        output: {
          value: 1n,
          summary: 'b'.repeat(10005),
        },
      })
    ).toEqual({
      output: {
        output: {
          value: '1',
          summary: `${'b'.repeat(10000)}... [truncated]`,
        },
      },
    });
  });

  test('buildToolSpanSchema embeds the provided input schema', () => {
    const schema = buildToolSpanSchema({
      type: 'object',
      properties: {
        file_path: { type: 'string' },
      },
      required: ['file_path'],
      additionalProperties: false,
    });

    expect(schema).toEqual({
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
            input: {
              type: 'object',
              properties: {
                file_path: { type: 'string' },
              },
              required: ['file_path'],
              additionalProperties: false,
            },
          },
          required: ['claude.tool.name', 'toolName'],
          additionalProperties: false,
        },
        outputs: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              properties: {
                output: {
                  anyOf: [
                    { type: 'null' },
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'boolean' },
                    { type: 'object', additionalProperties: true },
                    { type: 'array' },
                  ],
                },
              },
              required: ['output'],
              additionalProperties: false,
            },
          ],
        },
        metadata: { type: 'object', additionalProperties: true },
        token_usage: {
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
        },
        error: {
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
        },
      },
      required: ['span_id', 'trace_id', 'name', 'status', 'inputs', 'metadata'],
      additionalProperties: false,
    });
  });

  test('buildToolSpanSchema allows null outputs for interrupted or failed tool spans', () => {
    const schema = buildToolSpanSchema({ type: 'object' });

    // biome-ignore lint/suspicious/noExplicitAny: testing generated schema shape
    expect((schema as any).properties.outputs).toEqual({
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            output: {
              anyOf: [
                { type: 'null' },
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'object', additionalProperties: true },
                { type: 'array' },
              ],
            },
          },
          required: ['output'],
          additionalProperties: false,
        },
      ],
    });
  });

  test('buildToolSpanSchema uses error_type to match emitted error payloads', () => {
    const schema = buildToolSpanSchema({ type: 'object' });

    // biome-ignore lint/suspicious/noExplicitAny: testing generated schema shape
    const errorSchema = (schema as any).properties.error;
    expect(errorSchema).toEqual({
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
    });
  });
});
