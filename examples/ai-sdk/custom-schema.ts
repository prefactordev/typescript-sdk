/**
 * Vercel AI SDK Example with a custom Prefactor schema
 *
 * This example demonstrates passing a custom schema to Prefactor via httpConfig.agentSchema.
 *
 * Prerequisites:
 * - ANTHROPIC_API_KEY environment variable set
 * - PREFACTOR_API_URL and PREFACTOR_API_TOKEN for HTTP transport
 */

import { anthropic } from '@ai-sdk/anthropic';
import { generateText, wrapLanguageModel } from 'ai';
import { init, shutdown } from '@prefactor/ai';

const customSchema = {
  external_identifier: 'ai-sdk-example-2026-01-28',
  span_schemas: {
    agent: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        type: { type: 'string', const: 'agent' },
      },
    },
    llm: {
      type: 'object',
      properties: {
        'ai.model.id': { type: 'string' },
        'ai.model.provider': { type: 'string' },
        'ai.finishReason': { type: 'string' },
        type: { type: 'string', const: 'llm' },
      },
    },
    tool: {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'tool' },
      },
    },
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
      schemaName: 'prefactor:ai-sdk-example',
      schemaIdentifier: '2026-01-28',
    },
  });

  const model = wrapLanguageModel({
    model: anthropic('claude-3-haiku-20240307'),
    middleware,
  });

  const result = await generateText({
    model,
    prompt: 'Say hello and include today\'s date.',
  });

  console.log('Agent Response:');
  console.log(result.text);
  console.log();

  await shutdown();
  console.log('Shutdown complete');
  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
