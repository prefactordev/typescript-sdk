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

  test('createToolSpanOutputs normalizes undefined to null', () => {
    expect(createToolSpanOutputs(undefined)).toEqual({ output: null });
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
      required: ['span_id', 'trace_id', 'name', 'status', 'inputs', 'outputs', 'metadata'],
      additionalProperties: false,
    });
  });
});
