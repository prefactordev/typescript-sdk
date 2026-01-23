/**
 * Simple Anthropic Agent Example for Prefactor SDK
 *
 * This example demonstrates end-to-end tracing of a LangChain agent using
 * Anthropic's Claude model with the Prefactor SDK. It shows how the SDK
 * captures LLM calls, tool executions, and agent operations.
 *
 * Prerequisites:
 * - ANTHROPIC_API_KEY environment variable set
 * - Optional: PREFACTOR_API_URL and PREFACTOR_API_TOKEN for HTTP transport
 */

import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { init, shutdown } from '@prefactor/sdk';

// Define simple tools for the agent
const calculatorTool = tool(
  async ({ expression }: { expression: string }) => {
    try {
      // Simple evaluation for demo purposes
      // In production, use a proper math parser
      const result = eval(expression);
      return `Result: ${result}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'calculator',
    description: 'Evaluate a mathematical expression.',
    schema: z.object({
      expression: z.string().describe('The mathematical expression to evaluate'),
    }),
  }
);

const getCurrentTimeTool = tool(
  async () => {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 19);
  },
  {
    name: 'get_current_time',
    description: 'Get the current date and time.',
    schema: z.object({}),
  }
);

async function main() {
  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required. ' +
        'Please set it before running this example.'
    );
  }

  console.log('='.repeat(80));
  console.log('Prefactor SDK - Anthropic Agent Example');
  console.log('='.repeat(80));
  console.log();

  // Initialize Prefactor SDK
  console.log('Initializing Prefactor SDK...');
  const middleware = init({
    transportType: 'http',
    httpConfig: {
      apiUrl: process.env.PREFACTOR_API_URL || 'http://localhost:8000',
      apiToken: process.env.PREFACTOR_API_TOKEN || 'dev-token',
      agentId: process.env.PREFACTOR_AGENT_ID,
      agentVersion: '1.0.0',
    },
  });
  console.log('Prefactor middleware initialized');
  console.log();

  // Create tools list
  const tools = [calculatorTool, getCurrentTimeTool];

  // Create agent using the createAgent API with middleware
  console.log('Creating agent with createAgent API and Prefactor middleware...');
  const agent = createAgent({
    model: 'claude-haiku-4-5-20251001',
    tools,
    systemPrompt: 'You are a helpful assistant. Use the available tools to answer questions.',
    middleware: [middleware],
  });
  console.log('Agent created with Prefactor tracing');
  console.log();

  // Run test interactions
  console.log('='.repeat(80));
  console.log('Example 1: Getting Current Time');
  console.log('='.repeat(80));
  console.log();

  try {
    const result1 = await agent.invoke({
      messages: [{ role: 'user', content: 'What is the current date and time?' }],
    });
    console.log('\nAgent Response:');
    console.log(result1.messages[result1.messages.length - 1].content);
    console.log();
  } catch (error) {
    console.log(`Error in Example 1: ${error}`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log('Example 2: Simple Calculation');
  console.log('='.repeat(80));
  console.log();

  try {
    const result2 = await agent.invoke({
      messages: [{ role: 'user', content: 'What is 42 multiplied by 17?' }],
    });
    console.log('\nAgent Response:');
    console.log(result2.messages[result2.messages.length - 1].content);
    console.log();
  } catch (error) {
    console.log(`Error in Example 2: ${error}`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log('Example Complete!');
  console.log('='.repeat(80));
  console.log();
  console.log('The trace spans have been sent to the Prefactor API.');
  console.log('You should see spans for:');
  console.log('  - AGENT: Root agent execution span');
  console.log('  - LLM: Claude API calls with token usage');
  console.log('  - TOOL: calculator and get_current_time executions');
  console.log();
  console.log('Check parent_span_id fields to see the span hierarchy.');
  console.log();
  console.log('Note: This example uses the createAgent API from LangChain v1.');
  console.log();

  // Explicitly flush pending spans (also happens automatically via beforeExit)
  console.log('Flushing pending spans...');
  await shutdown();
  console.log('Shutdown complete');
  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
