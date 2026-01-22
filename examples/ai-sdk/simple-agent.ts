/**
 * Simple AI SDK Example for @prefactor/ai
 *
 * This example demonstrates end-to-end tracing of Vercel AI SDK operations
 * using @prefactor/ai's OTEL adapter. Telemetry is sent to the Prefactor platform
 * via HTTP transport, or to stdout for local development.
 *
 * Prerequisites:
 * - ANTHROPIC_API_KEY environment variable set
 * - For HTTP transport: PREFACTOR_API_URL and PREFACTOR_API_TOKEN
 */

import { generateText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { init, shutdown } from '@prefactor/ai';

// Define simple tools for the agent
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

async function main() {
  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required. ' +
        'Please set it before running this example.'
    );
  }

  console.log('='.repeat(80));
  console.log('@prefactor/ai - Vercel AI SDK Example');
  console.log('='.repeat(80));
  console.log();

  // Initialize @prefactor/ai tracer
  // Config is picked up from environment variables:
  // - PREFACTOR_TRANSPORT: 'stdio' or 'http' (default: 'stdio')
  // - PREFACTOR_API_URL: API endpoint for HTTP transport
  // - PREFACTOR_API_TOKEN: API token for HTTP transport
  // - PREFACTOR_AGENT_ID: Optional agent identifier
  console.log('Initializing @prefactor/ai tracer...');

  const tracer = init();
  const transportType = process.env.PREFACTOR_TRANSPORT || 'stdio';

  console.log(`Tracer initialized with ${transportType} transport`);
  console.log();

  // Run test interactions
  console.log('='.repeat(80));
  console.log('Example 1: Getting Current Time');
  console.log('='.repeat(80));
  console.log();

  try {
    const result1 = await generateText({
      model: anthropic('claude-3-haiku-20240307'),
      prompt: 'What is the current date and time?',
      tools: {
        get_current_time: getCurrentTimeTool,
      },
      maxSteps: 3,
      experimental_telemetry: {
        isEnabled: true,
        tracer,
      },
    });

    console.log('\nAgent Response:');
    console.log(result1.text);
    console.log();

    if (result1.toolCalls.length > 0) {
      console.log('Tool calls made:');
      for (const toolCall of result1.toolCalls) {
        console.log(`  - ${toolCall.toolName}: ${JSON.stringify(toolCall.input)}`);
      }
      console.log();
    }
  } catch (error) {
    console.log(`Error in Example 1: ${error}`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log('Example 2: Simple Calculation');
  console.log('='.repeat(80));
  console.log();

  try {
    const result2 = await generateText({
      model: anthropic('claude-3-haiku-20240307'),
      prompt: 'What is 42 multiplied by 17?',
      tools: {
        calculator: calculatorTool,
      },
      maxSteps: 3,
      experimental_telemetry: {
        isEnabled: true,
        tracer,
      },
    });

    console.log('\nAgent Response:');
    console.log(result2.text);
    console.log();

    if (result2.toolCalls.length > 0) {
      console.log('Tool calls made:');
      for (const toolCall of result2.toolCalls) {
        console.log(`  - ${toolCall.toolName}: ${JSON.stringify(toolCall.input)}`);
      }
      console.log();
    }
  } catch (error) {
    console.log(`Error in Example 2: ${error}`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log('Example 3: Multi-turn Conversation with Multiple Tools');
  console.log('='.repeat(80));
  console.log();

  try {
    const result3 = await generateText({
      model: anthropic('claude-3-haiku-20240307'),
      prompt: 'What time is it now, and what is 123 plus 456?',
      tools: {
        calculator: calculatorTool,
        get_current_time: getCurrentTimeTool,
      },
      maxSteps: 5,
      experimental_telemetry: {
        isEnabled: true,
        tracer,
      },
    });

    console.log('\nAgent Response:');
    console.log(result3.text);
    console.log();

    if (result3.toolCalls.length > 0) {
      console.log('Tool calls made:');
      for (const toolCall of result3.toolCalls) {
        console.log(`  - ${toolCall.toolName}: ${JSON.stringify(toolCall.input)}`);
      }
      console.log();
    }
  } catch (error) {
    console.log(`Error in Example 3: ${error}`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log('Example Complete!');
  console.log('='.repeat(80));
  console.log();

  if (transportType === 'http') {
    console.log('Trace spans have been sent to the Prefactor platform.');
    console.log('Check your Prefactor dashboard to view the traces.');
  } else {
    console.log('Trace spans have been output to stdout.');
    console.log('To send to Prefactor platform, set PREFACTOR_TRANSPORT=http and configure API credentials.');
  }
  console.log();
  console.log('Spans captured include:');
  console.log('  - LLM: Model calls (generateText, etc.)');
  console.log('  - TOOL: Tool executions (calculator, get_current_time)');
  console.log('  - CHAIN: Other AI SDK operations');
  console.log();

  // Explicitly flush pending spans
  console.log('Flushing pending spans...');
  await shutdown();
  console.log('Shutdown complete');
  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
