/**
 * Basic example of using Prefactor SDK with LangChain.js
 *
 * This example demonstrates:
 * - Initializing the SDK with HTTP transport
 * - How to integrate middleware with LangChain.js agents
 * - How to add manual instrumentation for non-framework workflow steps
 * - Graceful shutdown
 *
 * For a complete working example with real API calls, see:
 * examples/anthropic-agent/simple-agent.ts
 */

import { init, shutdown } from '@prefactor/langchain';

console.log('Prefactor SDK - Basic Example');
console.log('='.repeat(40));
console.log();

// Initialize Prefactor SDK (HTTP transport)
console.log('Initializing Prefactor SDK...');
const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL || 'http://localhost:8000',
    apiToken: process.env.PREFACTOR_API_TOKEN || 'dev-token',
    agentIdentifier: '1.0.0',
  },
});
console.log('SDK initialized with HTTP transport');
console.log();

// Example: How to use the middleware with LangChain.js
console.log('Usage with LangChain.js:');
console.log('-'.repeat(40));

console.log('Features:');
console.log('  - Automatic tracing of LLM calls');
console.log('  - Tool execution tracking');
console.log('  - Agent workflow monitoring');
console.log('  - Manual spans for external workflow steps');
console.log('  - Token usage capture');
console.log('  - Parent-child span relationships');
console.log();

console.log('Next steps:');
console.log('  - See examples/anthropic-agent/ for a complete working example');
console.log('  - Configure HTTP transport for production use');
console.log('  - Add custom metadata to spans');
console.log();

// Cleanup
console.log('Shutting down Prefactor SDK...');
await shutdown();
console.log('Shutdown complete');
console.log();
