/**
 * Claude Agent SDK Example for @prefactor/claude
 *
 * Demonstrates end-to-end tracing of a Claude Agent SDK session using
 * @prefactor/claude. The agent uses built-in tools (Read, Glob, Grep, Bash)
 * to explore the current repository and answer a question about its structure.
 *
 * This example includes custom tool schemas that provide structured, queryable
 * trace data for each tool type (Read, Edit, Glob, Grep, Bash, Write, etc.).
 *
 * Run:
 *   bun examples/claude-agent/simple-agent.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { init } from '@prefactor/core';
import { PrefactorClaude } from '@prefactor/claude';

const agentSchema = {
  external_identifier: "claude-simple-agent-2026-03",

  toolSchemas: {
    Read: {
      spanType: "claude:tool:read",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file",
          },
          offset: {
            type: "number",
            description: "Line offset to start reading from",
          },
          limit: { type: "number", description: "Maximum lines to read" },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
    },

    Edit: {
      spanType: "claude:tool:edit",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file",
          },
          old_string: {
            type: "string",
            description: "Text to find and replace",
          },
          new_string: { type: "string", description: "Replacement text" },
          replace_all: {
            type: "boolean",
            description: "Whether to replace all occurrences",
          },
        },
        required: ["file_path", "old_string", "new_string"],
        additionalProperties: false,
      },
    },

    Glob: {
      spanType: "claude:tool:glob",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern (e.g. **/*.ts)",
          },
          path: { type: "string", description: "Directory to search in" },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },

    Grep: {
      spanType: "claude:tool:grep",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          path: { type: "string", description: "File or directory to search" },
          glob: { type: "string", description: "File glob filter" },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
          },
        },
        required: ["pattern"],
        additionalProperties: true,
      },
    },

    Bash: {
      spanType: "claude:tool:bash",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          description: {
            type: "string",
            description: "Human-readable description",
          },
          timeout: { type: "number", description: "Timeout in milliseconds" },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },

    Write: {
      spanType: "claude:tool:write",
      inputSchema: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to write" },
          content: { type: "string", description: "File content" },
        },
        required: ["file_path", "content"],
        additionalProperties: false,
      },
    },

    WebFetch: {
      spanType: "claude:tool:web-fetch",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
          prompt: { type: "string", description: "Extraction prompt" },
        },
        required: ["url"],
        additionalProperties: true,
      },
    },

    Agent: {
      spanType: "claude:tool:agent",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Task for the subagent" },
          description: {
            type: "string",
            description: "Short description of the task",
          },
          model: {
            type: "string",
            description: "Model override for the subagent",
          },
        },
        required: ["prompt"],
        additionalProperties: true,
      },
    },
  },

  span_schemas: {
    "claude:agent": {
      type: "object",
      properties: {
        inputs: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            model: { type: "string" },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    "claude:llm": {
      type: "object",
      properties: {
        inputs: { type: "object", additionalProperties: true },
        outputs: {
          type: "object",
          properties: {
            "claude.response.content": {},
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    "claude:tool": { type: "object", additionalProperties: true },
    "claude:subagent": {
      type: "object",
      properties: {
        inputs: {
          type: "object",
          properties: {
            agent_id: { type: "string" },
            agent_type: { type: "string" },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
  },

  span_result_schemas: {
    "claude:agent": {
      type: "object",
      properties: {
        result: { type: "string" },
        subtype: { type: "string" },
        stop_reason: { type: "string" },
        num_turns: { type: "number" },
        total_cost_usd: { type: "number" },
        is_error: { type: "boolean" },
      },
      additionalProperties: true,
    },
    "claude:llm": { type: "object", additionalProperties: true },
    "claude:tool": { type: "object", additionalProperties: true },
    "claude:subagent": {
      type: "object",
      properties: {
        agent_type: { type: "string" },
        transcript_path: { type: "string" },
      },
      additionalProperties: true,
    },
  },
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. " +
        "Please set it before running this example."
    );
  }

  const prefactor = init({
    provider: new PrefactorClaude({ query, agentSchema }),
    httpConfig: {
      apiUrl: process.env.PREFACTOR_API_URL || "http://localhost:8000",
      apiToken: process.env.PREFACTOR_API_TOKEN || "dev-token",
      agentId: process.env.PREFACTOR_AGENT_ID,
      agentIdentifier: "claude-simple-v1",
      agentName: "Claude Simple Agent",
      agentDescription:
        "An agent demonstrating @prefactor/claude tracing with custom tool schemas.",
      agentSchema,
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
      model: 'claude-3-haiku-20240307'
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
