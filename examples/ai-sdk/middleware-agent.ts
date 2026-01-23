/**
 * Middleware AI SDK Example for @prefactor/ai-middleware
 *
 * This example demonstrates end-to-end tracing of Vercel AI SDK operations
 * using @prefactor/ai-middleware's wrapLanguageModel approach. This is an
 * alternative to the experimental_telemetry tracer approach.
 *
 * Prerequisites:
 * - ANTHROPIC_API_KEY environment variable set
 * - For HTTP transport: PREFACTOR_API_URL and PREFACTOR_API_TOKEN
 */

import { generateText, wrapLanguageModel, tool, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { init, shutdown } from '@prefactor/ai-middleware';

// Define tools for the agent

const calculatorTool = tool({
  description: 'Evaluate a mathematical expression.',
  inputSchema: z.object({
    expression: z.string().describe('The mathematical expression to evaluate'),
  }),
  execute: async ({ expression }) => {
    try {
      // Simple evaluation for demo purposes
      // In production, use a proper math parser
      const result = eval(expression);
      return `Result: ${result}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

const getCurrentTimeTool = tool({
  description: 'Get the current date and time.',
  inputSchema: z.object({}),
  execute: async () => {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 19);
  },
});

const randomNumberTool = tool({
  description: 'Generate a random number between min and max (inclusive).',
  inputSchema: z.object({
    min: z.number().describe('The minimum value'),
    max: z.number().describe('The maximum value'),
  }),
  execute: async ({ min, max }) => {
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return `Random number: ${result}`;
  },
});

async function main() {
  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required. ' +
        'Please set it before running this example.'
    );
  }

  console.log('='.repeat(80));
  console.log('@prefactor/ai-middleware - Vercel AI SDK Middleware Example');
  console.log('='.repeat(80));
  console.log();

  // Initialize @prefactor/ai-middleware
  // Config is picked up from environment variables:
  // - PREFACTOR_TRANSPORT: 'stdio' or 'http' (default: 'stdio')
  // - PREFACTOR_API_URL: API endpoint for HTTP transport
  // - PREFACTOR_API_TOKEN: API token for HTTP transport
  // - PREFACTOR_AGENT_ID: Optional agent identifier
  console.log('Initializing @prefactor/ai-middleware...');

  const middleware = init({
    httpConfig: {
      apiToken: process.env.PREFACTOR_API_TOKEN!,
      apiUrl: process.env.PREFACTOR_API_URL!,
      agentId: process.env.PREFACTOR_AGENT_ID,
      agentVersion: '1.0.0',
      agentName: 'Middleware Agent',
      agentDescription: 'An agent demonstrating the middleware approach.',
    },
  });

  // Wrap the model with our middleware
  // This is the key difference from the experimental_telemetry approach
  const model = wrapLanguageModel({
    model: anthropic('claude-3-haiku-20240307'),
    middleware,
  });

  console.log('Model wrapped with Prefactor middleware');
  console.log();

  // Example: Use the tools to generate everything
  try {
    const result = await generateText({
      model,
      prompt:
        'What time is it right now? Also, generate a random number between 1 and 10, then multiply it by 7.',
      tools: {
        calculator: calculatorTool,
        get_current_time: getCurrentTimeTool,
        random_number: randomNumberTool,
      },
      stopWhen: stepCountIs(8),
    });

    console.log('Agent Response:');
    console.log(result.text);
    console.log();

    if (result.toolCalls.length > 0) {
      console.log('Tool calls made:');
      for (const toolCall of result.toolCalls) {
        console.log(`  - ${toolCall.toolName}: ${JSON.stringify(toolCall.input)}`);
      }
      console.log();
    }
  } catch (error) {
    console.log(`Error in Example: ${error}`);
    console.log();
  }

  await shutdown();
  console.log('Shutdown complete');
  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
