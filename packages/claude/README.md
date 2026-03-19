# @prefactor/claude

Claude Agent SDK integration for Prefactor observability. Provides automatic tracing of Claude agent runs, LLM calls, tool executions, and subagent workflows via a traced `query` wrapper.

## Installation

```bash
npm install @prefactor/claude
# or
bun add @prefactor/claude
```

**Note:** This package requires `@prefactor/core` and `@anthropic-ai/claude-agent-sdk` as peer dependencies:

```bash
npm install @prefactor/core @anthropic-ai/claude-agent-sdk
# or
bun add @prefactor/core @anthropic-ai/claude-agent-sdk
```

## Quick Start

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { init } from '@prefactor/core';
import { PrefactorClaude } from '@prefactor/claude';

const prefactor = init({
  provider: new PrefactorClaude({ query }),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: 'v1.0.0',
  },
});

const { tracedQuery } = prefactor.getMiddleware();

for await (const message of tracedQuery({
  prompt: 'Explain this codebase',
  options: {
    allowedTools: ['Read', 'Glob', 'Grep'],
  },
})) {
  if ('result' in message) {
    console.log(message.result);
  }
}

await prefactor.shutdown();
```

## Exports

### Provider

```typescript
import {
  PrefactorClaude,
  DEFAULT_CLAUDE_AGENT_SCHEMA,
} from '@prefactor/claude';
```

### Types

```typescript
import type {
  ClaudeMiddleware,
  ClaudeQuery,
  JsonSchema,
  PrefactorClaudeOptions,
  ToolSchemaConfig,
} from '@prefactor/claude';
```

Core initialization and lifecycle utilities come from `@prefactor/core`:

```typescript
import {
  init,
  type PrefactorOptions,
} from '@prefactor/core';
```

## Configuration

### Environment Variables

The SDK can be configured using environment variables:

- `PREFACTOR_API_URL`: API endpoint for HTTP transport
- `PREFACTOR_API_TOKEN`: Authentication token for HTTP transport
- `PREFACTOR_AGENT_ID`: Optional agent instance identifier
- `PREFACTOR_SAMPLE_RATE`: Sampling rate 0.0-1.0 (default: `1.0`)
- `PREFACTOR_CAPTURE_INPUTS`: Capture span inputs (default: `true`)
- `PREFACTOR_CAPTURE_OUTPUTS`: Capture span outputs (default: `true`)
- `PREFACTOR_MAX_INPUT_LENGTH`: Max input string length (default: `10000`)
- `PREFACTOR_MAX_OUTPUT_LENGTH`: Max output string length (default: `10000`)
- `PREFACTOR_LOG_LEVEL`: `"debug"` | `"info"` | `"warn"` | `"error"` (default: `"info"`)

### Programmatic Configuration

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { init } from '@prefactor/core';
import { PrefactorClaude, DEFAULT_CLAUDE_AGENT_SCHEMA } from '@prefactor/claude';

const prefactor = init({
  provider: new PrefactorClaude({ query }),
  httpConfig: {
    apiUrl: 'https://app.prefactorai.com',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
    agentIdentifier: '1.0.0',
    agentName: 'My Claude Agent',
    agentDescription: 'A Claude-powered coding agent',
    agentSchema: {
      ...DEFAULT_CLAUDE_AGENT_SCHEMA,
      toolSchemas: {
        Read: {
          spanType: 'claude:tool:read',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
            },
          },
        },
      },
    },
  },
});
```

Custom agent schemas should be passed through `httpConfig.agentSchema`, not the provider constructor.

## What Gets Traced

The Claude integration automatically captures:

- **Agent Runs**: Top-level agent spans for each traced query
- **LLM Calls**: Model events, prompts, outputs, and usage when available
- **Tool Executions**: Tool name, inputs, outputs, duration, and tool-specific span types
- **Subagent Operations**: Child spans for nested Claude agent activity
- **Errors**: Stream and execution failures with error details

## Requirements

- Node.js >= 22.0.0
- `@anthropic-ai/claude-agent-sdk` ^0.2.0
