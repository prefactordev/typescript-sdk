/**
 * Claude Agent SDK Example for @prefactor/claude
 *
 * Demonstrates end-to-end tracing of a Claude Agent SDK session using
 * @prefactor/claude. The agent uses built-in tools (Read, Glob, Grep, Bash)
 * to explore the current repository and answer a question about its structure.
 *
 * Captured spans:
 *   - claude:agent   — the full session
 *   - claude:llm     — each LLM turn (assistant message)
 *   - claude:tool    — each tool call (Read, Glob, Grep, Bash)
 *   - claude:subagent — any spawned subagents
 *
 * Prerequisites:
 * - ANTHROPIC_API_KEY environment variable set
 * - For HTTP transport: PREFACTOR_API_URL and PREFACTOR_API_TOKEN
 *
 * Run:
 *   bun examples/claude-agent/simple-agent.ts
 */

import { init } from '@prefactor/core';
import { PrefactorClaude } from '@prefactor/claude';

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required. ' +
        'Please set it before running this example.'
    );
  }

  console.log('='.repeat(80));
  console.log('@prefactor/claude - Simple Agent Example');
  console.log('='.repeat(80));
  console.log();

  const prefactor = init({
    provider: new PrefactorClaude(),
    httpConfig: {
      apiUrl: process.env.PREFACTOR_API_URL || 'http://localhost:8000',
      apiToken: process.env.PREFACTOR_API_TOKEN || 'dev-token',
      agentId: process.env.PREFACTOR_AGENT_ID,
      agentIdentifier: 'claude-simple-v1',
      agentName: 'Claude Simple Agent',
      agentDescription: 'An agent demonstrating @prefactor/claude tracing.',
    },
  });

  const { tracedQuery } = prefactor.getMiddleware();

  console.log('Sending query to Claude Agent SDK...');
  console.log();

  for await (const message of tracedQuery({
    prompt:
      'List the top-level files and directories in this repository, then read the package.json and tell me what packages are in this monorepo.',
    options: {
      allowedTools: ['Read', 'Glob', 'Bash'],
      maxTurns: 6,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    },
  })) {
    if (message.type === 'system' && 'session_id' in message) {
      console.log(`Session: ${message.session_id}`);
      console.log();
    }

    if ('result' in message) {
      console.log('Agent Response:');
      console.log(message.result);
      console.log();

      if ('usage' in message && message.usage) {
        // biome-ignore lint/suspicious/noExplicitAny: SDK message types are a wide union
        const usage = message.usage as any;
        console.log(
          `Tokens — input: ${usage.input_tokens ?? '?'}, output: ${usage.output_tokens ?? '?'}`
        );
      }
    }
  }

  await prefactor.shutdown();
  console.log();
  console.log('Shutdown complete. Check your Prefactor dashboard for traces.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
