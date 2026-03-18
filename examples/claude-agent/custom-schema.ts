/**
 * Claude Agent SDK Example with Custom Tool Schemas
 *
 * Demonstrates @prefactor/claude with per-tool span schemas. Each built-in
 * Claude tool gets its own schema that validates the specific inputs and
 * outputs that tool produces, giving you structured, queryable trace data.
 *
 * The schema below defines typed spans for:
 *   - Read     — file reads with path and line range
 *   - Edit     — file edits with old/new string context
 *   - Glob     — file pattern searches
 *   - Grep     — content searches with regex patterns
 *   - Bash     — shell command executions
 *   - Write    — file creation with path and content length
 *   - WebFetch — URL fetches
 *   - Agent    — subagent dispatches with prompt and model
 *
 * Prerequisites:
 * - ANTHROPIC_API_KEY environment variable set
 * - PREFACTOR_API_URL and PREFACTOR_API_TOKEN for HTTP transport
 *
 * Run:
 *   bun examples/claude-agent/custom-schema.ts
 */

import { init } from '@prefactor/core';
import { PrefactorClaude } from '@prefactor/claude';

// ---------------------------------------------------------------------------
// Custom agent schema with per-tool span types
// ---------------------------------------------------------------------------

const agentSchema = {
  external_identifier: 'claude-custom-schema-2026-03',

  // Map each Claude tool name to a unique span type + input schema.
  // The span type controls how the tool span appears in the Prefactor UI,
  // and the input schema validates/shapes the trace payload.
  toolSchemas: {
    Read: {
      spanType: 'claude:tool:read',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file' },
          offset: { type: 'number', description: 'Line offset to start reading from' },
          limit: { type: 'number', description: 'Maximum lines to read' },
        },
        required: ['file_path'],
        additionalProperties: false,
      },
    },

    Edit: {
      spanType: 'claude:tool:edit',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file' },
          old_string: { type: 'string', description: 'Text to find and replace' },
          new_string: { type: 'string', description: 'Replacement text' },
          replace_all: { type: 'boolean', description: 'Whether to replace all occurrences' },
        },
        required: ['file_path', 'old_string', 'new_string'],
        additionalProperties: false,
      },
    },

    Glob: {
      spanType: 'claude:tool:glob',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. **/*.ts)' },
          path: { type: 'string', description: 'Directory to search in' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },

    Grep: {
      spanType: 'claude:tool:grep',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'File or directory to search' },
          glob: { type: 'string', description: 'File glob filter' },
          output_mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
          },
        },
        required: ['pattern'],
        additionalProperties: true,
      },
    },

    Bash: {
      spanType: 'claude:tool:bash',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          description: { type: 'string', description: 'Human-readable description' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },

    Write: {
      spanType: 'claude:tool:write',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to write' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['file_path', 'content'],
        additionalProperties: false,
      },
    },

    WebFetch: {
      spanType: 'claude:tool:web-fetch',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          prompt: { type: 'string', description: 'Extraction prompt' },
        },
        required: ['url'],
        additionalProperties: true,
      },
    },

    Agent: {
      spanType: 'claude:tool:agent',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Task for the subagent' },
          description: { type: 'string', description: 'Short description of the task' },
          model: { type: 'string', description: 'Model override for the subagent' },
        },
        required: ['prompt'],
        additionalProperties: true,
      },
    },
  },

  // Base span schemas for the four core span types.
  span_schemas: {
    'claude:agent': {
      type: 'object',
      properties: {
        inputs: {
          type: 'object',
          properties: {
            session_id: { type: 'string' },
            model: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    'claude:llm': {
      type: 'object',
      properties: {
        inputs: { type: 'object', additionalProperties: true },
        outputs: {
          type: 'object',
          properties: {
            'claude.response.content': {},
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    'claude:tool': { type: 'object', additionalProperties: true },
    'claude:subagent': {
      type: 'object',
      properties: {
        inputs: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            agent_type: { type: 'string' },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
  },

  span_result_schemas: {
    'claude:agent': {
      type: 'object',
      properties: {
        result: { type: 'string' },
        subtype: { type: 'string' },
        stop_reason: { type: 'string' },
        num_turns: { type: 'number' },
        total_cost_usd: { type: 'number' },
        is_error: { type: 'boolean' },
      },
      additionalProperties: true,
    },
    'claude:llm': { type: 'object', additionalProperties: true },
    'claude:tool': { type: 'object', additionalProperties: true },
    'claude:subagent': {
      type: 'object',
      properties: {
        agent_type: { type: 'string' },
        transcript_path: { type: 'string' },
      },
      additionalProperties: true,
    },
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { ANTHROPIC_API_KEY, PREFACTOR_API_URL, PREFACTOR_API_TOKEN, PREFACTOR_AGENT_ID } =
    process.env;

  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required.');
  }
  if (!PREFACTOR_API_URL || !PREFACTOR_API_TOKEN) {
    throw new Error('PREFACTOR_API_URL and PREFACTOR_API_TOKEN are required for HTTP transport.');
  }

  console.log('='.repeat(80));
  console.log('@prefactor/claude - Custom Tool Schema Example');
  console.log('='.repeat(80));
  console.log();

  const prefactor = init({
    provider: new PrefactorClaude({ agentSchema }),
    httpConfig: {
      apiUrl: PREFACTOR_API_URL,
      apiToken: PREFACTOR_API_TOKEN,
      agentId: PREFACTOR_AGENT_ID,
      agentIdentifier: 'claude-schema-v1',
      agentName: 'Claude Schema Agent',
      agentDescription: 'Demonstrates per-tool span schemas with @prefactor/claude.',
      agentSchema,
    },
  });

  const { tracedQuery } = prefactor.getMiddleware();

  console.log('Tool span types registered:');
  console.log('  Read   -> claude:tool:read');
  console.log('  Edit   -> claude:tool:edit');
  console.log('  Glob   -> claude:tool:glob');
  console.log('  Grep   -> claude:tool:grep');
  console.log('  Bash   -> claude:tool:bash');
  console.log('  Write  -> claude:tool:write');
  console.log('  Agent  -> claude:tool:agent');
  console.log();
  console.log('Sending query...');
  console.log();

  for await (const message of tracedQuery({
    prompt: [
      'Investigate this repository:',
      '1. Use Glob to find all package.json files under packages/',
      '2. Use Grep to search for "PrefactorProvider" across the src directories',
      '3. Read the root package.json to get the project name and version',
      '4. Use Bash to run "git log --oneline -5" and show the last 5 commits',
      '5. Summarize what this repo is, what packages it contains, and what pattern the provider packages follow.',
    ].join('\n'),
    options: {
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
      maxTurns: 10,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    },
  })) {
    if (message.type === 'system' && 'session_id' in message) {
      console.log(`Session: ${message.session_id}`);
    }

    if ('result' in message) {
      console.log();
      console.log('Agent Response:');
      console.log(message.result);
      console.log();

      if ('num_turns' in message) {
        // biome-ignore lint/suspicious/noExplicitAny: SDK message types are a wide union
        const msg = message as any;
        console.log(`Turns: ${msg.num_turns ?? '?'}`);
        console.log(`Cost:  $${msg.total_cost_usd?.toFixed(4) ?? '?'}`);
      }

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
  console.log('Shutdown complete.');
  console.log();
  console.log('In your Prefactor dashboard you should see:');
  console.log('  - A claude:agent span for the full session');
  console.log('  - claude:llm spans for each LLM turn');
  console.log('  - claude:tool:glob, claude:tool:grep, claude:tool:read, claude:tool:bash spans');
  console.log('    each with typed inputs matching their tool schema');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
