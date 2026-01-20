/**
 * Basic example of using Prefactor SDK with LangChain.js
 *
 * This example demonstrates:
 * - Initializing the SDK with stdio transport (default)
 * - How to integrate middleware with LangChain.js agents
 * - Graceful shutdown
 *
 * For a complete working example with real API calls, see:
 * examples/anthropic-agent/simple-agent.ts
 */

import { init, shutdown } from '../src/index.js';

console.log('Prefactor SDK - Basic Example');
console.log('='.repeat(40));
console.log();

// Initialize Prefactor SDK (uses stdio transport by default)
console.log('Initializing Prefactor SDK...');
const middleware = init();
console.log('✓ SDK initialized with stdio transport');
console.log('  Spans will be output as newline-delimited JSON to stdout');
console.log();

// Example: How to use the middleware with LangChain.js
console.log('Usage with LangChain.js:');
console.log('─'.repeat(40));
console.log(`
import { createAgent } from 'langchain';
import { init } from '@prefactor/sdk';

// Initialize SDK
const middleware = init();

// Create agent with Prefactor middleware
const agent = createAgent({
  model: 'claude-sonnet-4-5-20250929',
  tools: [myTool1, myTool2],
  systemPrompt: 'You are a helpful assistant.',
  middleware: [middleware],  // 👈 Add middleware here
});

// Run your agent - all calls are automatically traced!
const result = await agent.invoke({
  messages: [{ role: 'user', content: 'Hello!' }],
});
`);

console.log('Features:');
console.log('  ✓ Automatic tracing of LLM calls');
console.log('  ✓ Tool execution tracking');
console.log('  ✓ Agent workflow monitoring');
console.log('  ✓ Token usage capture');
console.log('  ✓ Parent-child span relationships');
console.log();

console.log('Next steps:');
console.log('  - See examples/anthropic-agent/ for a complete working example');
console.log('  - Configure HTTP transport for production use');
console.log('  - Add custom metadata and tags to spans');
console.log();

// Cleanup
console.log('Shutting down Prefactor SDK...');
await shutdown();
console.log('✓ Shutdown complete');
console.log();
