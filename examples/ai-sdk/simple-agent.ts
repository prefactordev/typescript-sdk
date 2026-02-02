/**
 * Middleware AI SDK Example for @prefactor/ai
 *
 * This example demonstrates end-to-end tracing of Vercel AI SDK operations
 * using @prefactor/ai's wrapLanguageModel approach. This is an
 * alternative to the experimental_telemetry tracer approach.
 *
 * Prerequisites:
 * - ANTHROPIC_API_KEY environment variable set
 * - For HTTP transport: PREFACTOR_API_URL and PREFACTOR_API_TOKEN
 */

import { generateText, wrapLanguageModel, tool, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { init, shutdown } from '@prefactor/ai';

const calculateTool = tool({
  description: 'Perform basic arithmetic operations (+, -, *, /).',
  inputSchema: z.object({
    operation: z.enum(['+', '-', '*', '/']).describe('The arithmetic operation'),
    left: z.number().describe('Left operand'),
    right: z.number().describe('Right operand'),
  }),
  execute: async ({ operation, left, right }) => {
    let result: number;
    switch (operation) {
      case '+':
        result = left + right;
        break;
      case '-':
        result = left - right;
        break;
      case '*':
        result = left * right;
        break;
      case '/':
        if (right === 0) return 'Error: Division by zero';
        result = left / right;
        break;
    }
    return `Result: ${Math.round(result * 1000) / 1000}`;
  },
});

const getCurrentTimeTool = tool({
  description: 'Get the current time as hours, minutes, and seconds since midnight.',
  inputSchema: z.object({}),
  execute: async () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    return JSON.stringify({
      hours,
      minutes,
      seconds,
      totalSeconds,
      formatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    });
  },
});

const getTimeDifferenceTool = tool({
  description: 'Calculate the difference between two times in seconds.',
  inputSchema: z.object({
    seconds1: z.number().describe('First time in seconds since midnight'),
    seconds2: z.number().describe('Second time in seconds since midnight'),
  }),
  execute: async ({ seconds1, seconds2 }) => {
    const diff = Math.abs(seconds2 - seconds1);
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    return JSON.stringify({
      totalSeconds: diff,
      hours,
      minutes,
      seconds,
      formatted: `${hours}h ${minutes}m ${seconds}s`,
    });
  },
});

const addTimeTool = tool({
  description: 'Add minutes to a time (given in seconds since midnight) and return the new time.',
  inputSchema: z.object({
    currentSeconds: z.number().describe('Current time in seconds since midnight'),
    minutesToAdd: z.number().describe('Number of minutes to add (1-59)'),
  }),
  execute: async ({ currentSeconds, minutesToAdd }) => {
    const newSeconds = currentSeconds + minutesToAdd * 60;
    const hours = Math.floor((newSeconds % 86400) / 3600);
    const minutes = Math.floor((newSeconds % 3600) / 60);
    return JSON.stringify({
      totalSeconds: newSeconds % 86400,
      hours,
      minutes,
      formatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    });
  },
});

const randomMinutesTool = tool({
  description: 'Generate a random number of minutes between 1 and 59.',
  inputSchema: z.object({}),
  execute: async () => {
    const minutes = Math.floor(Math.random() * 59) + 1;
    return String(minutes);
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

  // Initialize @prefactor/ai
  // Config is picked up from environment variables:
  // - PREFACTOR_TRANSPORT: 'stdio' or 'http' (default: 'stdio')
  // - PREFACTOR_API_URL: API endpoint for HTTP transport
  // - PREFACTOR_API_TOKEN: API token for HTTP transport
  // - PREFACTOR_AGENT_ID: Optional agent identifier
  console.log('Initializing @prefactor/ai...');

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
        'Get the current time, generate a random number of minutes, add those minutes to the current time to get a future time, then calculate the difference in seconds between the two times.',
      tools: {
        calculate: calculateTool,
        get_current_time: getCurrentTimeTool,
        get_time_difference: getTimeDifferenceTool,
        add_time: addTimeTool,
        random_minutes: randomMinutesTool,
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
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
