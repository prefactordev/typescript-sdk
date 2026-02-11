/**
 * Vercel AI SDK Example with a custom Prefactor schema
 *
 * This example demonstrates passing a custom input/result schema to Prefactor
 * via httpConfig.agentSchema.
 *
 * Prerequisites:
 * - ANTHROPIC_API_KEY environment variable set
 * - PREFACTOR_API_URL and PREFACTOR_API_TOKEN for HTTP transport
 */

import { anthropic } from '@ai-sdk/anthropic';
import { generateText, tool, wrapLanguageModel } from 'ai';
import { init, shutdown, withSpan } from '@prefactor/ai';
import { z } from 'zod';

const customSchema = {
  external_identifier: 'ai-sdk-example-2026-02-11',
  span_schemas: {
    'ai-sdk:agent': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        status: { type: 'string' },
        inputs: { type: 'object' },
      },
      additionalProperties: true,
    },
    'ai-sdk:llm': {
      type: 'object',
      properties: {
        inputs: {
          type: 'object',
          properties: {
            'ai.model.id': { type: 'string' },
            'ai.model.provider': { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    'ai-sdk:tool': {
      type: 'object',
      properties: {
        inputs: {
          type: 'object',
          properties: {
            toolName: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    'custom:normalize-response': {
      type: 'object',
      properties: {
        inputs: {
          type: 'object',
          properties: {
            rawLength: { type: 'number' },
          },
          required: ['rawLength'],
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    'custom:build-summary': {
      type: 'object',
      properties: {
        inputs: {
          type: 'object',
          properties: {
            normalizedLength: { type: 'number' },
          },
          required: ['normalizedLength'],
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
  },
  span_result_schemas: {
    'ai-sdk:agent': { type: 'object', additionalProperties: false },
    'ai-sdk:llm': {
      type: 'object',
      properties: {
        'ai.response.text': { type: 'string' },
      },
      additionalProperties: true,
    },
    'ai-sdk:tool': {
      type: 'object',
      properties: {
        output: { type: 'string' },
      },
      additionalProperties: true,
    },
    'custom:normalize-response': { type: 'object', additionalProperties: false },
    'custom:build-summary': { type: 'object', additionalProperties: false },
  },
};

async function main() {
  const {
    ANTHROPIC_API_KEY,
    PREFACTOR_API_URL,
    PREFACTOR_API_TOKEN,
    PREFACTOR_AGENT_ID,
  } = process.env;

  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required. ' +
        'Please set it before running this example.'
    );
  }

  if (!PREFACTOR_API_URL || !PREFACTOR_API_TOKEN) {
    throw new Error(
      'PREFACTOR_API_URL and PREFACTOR_API_TOKEN are required for HTTP transport.'
    );
  }

  console.log('='.repeat(80));
  console.log('@prefactor/ai - Custom Schema Example');
  console.log('='.repeat(80));
  console.log();

  const middleware = init({
    transportType: 'http',
    httpConfig: {
      apiUrl: PREFACTOR_API_URL,
      apiToken: PREFACTOR_API_TOKEN,
      agentId: PREFACTOR_AGENT_ID,
      agentIdentifier: '1.0.0',
      agentName: 'AI SDK Custom Schema Demo',
      agentSchema: customSchema,
    },
  });

  const model = wrapLanguageModel({
    model: anthropic('claude-3-haiku-20240307'),
    middleware,
  });

  const getTodayDateTool = tool({
    description: 'Get today\'s date in YYYY-MM-DD format.',
    inputSchema: z.object({}),
    execute: async () => new Date().toISOString().slice(0, 10),
  });

  const result = await generateText({
    model,
    prompt:
      'Use the get_today_date tool to get today\'s date, then respond with a short greeting including that date.',
    tools: {
      get_today_date: getTodayDateTool,
    },
    toolChoice: 'required',
  });

  const normalizedResponse = await withSpan(
    {
      name: 'custom:normalize_response',
      spanType: 'custom:normalize-response',
      inputs: {
        rawLength: result.text.length,
      },
    },
    async () => result.text.replace(/\s+/g, ' ').trim()
  );

  const summary = await withSpan(
    {
      name: 'custom:build_summary',
      spanType: 'custom:build-summary',
      inputs: {
        normalizedLength: normalizedResponse.length,
      },
    },
    async () => ({
      preview: normalizedResponse.slice(0, 80),
      wordCount: normalizedResponse.split(/\s+/).filter(Boolean).length,
    })
  );

  console.log('Agent Response:');
  console.log(normalizedResponse);
  console.log();
  console.log('Summary:');
  console.log(summary);
  console.log();

  await shutdown();
  console.log('Shutdown complete');
  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
