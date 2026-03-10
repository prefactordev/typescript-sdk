# @prefactor/langchain

LangChain.js integration for Prefactor observability. Provides automatic tracing of LLM calls, tool executions, and agent workflows with minimal setup.

## Installation

```bash
npm install @prefactor/langchain
# or
bun add @prefactor/langchain
```

Note: This package requires `@prefactor/core` as a peer dependency, which will be installed automatically.

## Peer Dependencies

This package requires LangChain.js v1.0.0 or later:

```bash
npm install langchain@^1.0.0
```

## Quick Start

```typescript
import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { init } from '@prefactor/core';
import { PrefactorLangChain } from '@prefactor/langchain';

const prefactor = init({
  provider: new PrefactorLangChain(),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: '1.0.0',
  },
});

// Create agent with middleware
const agent = createAgent({
  model: 'claude-sonnet-4-5-20250929',
  tools: [],
  systemPrompt: 'You are a helpful assistant.',
  middleware: [prefactor.getMiddleware()],
});

// All operations are automatically traced
const result = await agent.invoke({
  messages: [{ role: 'user', content: 'Hello!' }],
});

await prefactor.shutdown();
```

## Exports

### Provider

```typescript
import {
  PrefactorLangChain,
  DEFAULT_LANGCHAIN_AGENT_SCHEMA,
} from '@prefactor/langchain';
```

### Types

```typescript
import type { AgentMiddleware } from '@prefactor/langchain';
```

Core initialization/lifecycle utilities come from `@prefactor/core`.

## Configuration

### Environment Variables

- `PREFACTOR_API_URL`: API endpoint for HTTP transport
- `PREFACTOR_API_TOKEN`: Authentication token
- `PREFACTOR_SAMPLE_RATE`: Sampling rate 0.0-1.0 (default: `1.0`)
- `PREFACTOR_CAPTURE_INPUTS`: Capture span inputs (default: `true`)
- `PREFACTOR_CAPTURE_OUTPUTS`: Capture span outputs (default: `true`)
- `PREFACTOR_MAX_INPUT_LENGTH`: Max input string length (default: `10000`)
- `PREFACTOR_MAX_OUTPUT_LENGTH`: Max output string length (default: `10000`)
- `PREFACTOR_LOG_LEVEL`: `"debug"` | `"info"` | `"warn"` | `"error"` (default: `"info")`

### Programmatic Configuration

```typescript
import { init } from '@prefactor/core';
import { PrefactorLangChain } from '@prefactor/langchain';

const prefactor = init({
  provider: new PrefactorLangChain(),
  httpConfig: {
    apiUrl: 'https://app.prefactorai.com',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
    agentIdentifier: '1.0.0',
    agentName: 'My Agent',
    agentDescription: 'An agent description',
  },
});
```

## What Gets Traced

The middleware automatically captures:

- **LLM Calls**: Model name, inputs, outputs, token usage
- **Tool Executions**: Tool name, inputs, outputs, duration
- **Agent Operations**: Full workflow with parent-child relationships
- **Errors**: Stack traces and error messages

## Manual Instrumentation

For operations not automatically traced, use `prefactor.withSpan(...)` from core.

```typescript
await prefactor.withSpan(
  {
    name: 'custom-operation',
    spanType: 'langchain:tool',
    inputs: { data: 'example' },
  },
  async () => doWork()
);
```

## Graceful Shutdown

Always call `prefactor.shutdown()` before your application exits to ensure all pending spans are flushed:

```typescript
import { init } from '@prefactor/core';
import { PrefactorLangChain } from '@prefactor/langchain';

const prefactor = init({
  provider: new PrefactorLangChain(),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
  },
});

process.on('SIGTERM', async () => {
  await prefactor.shutdown();
  process.exit(0);
});
```

## Requirements

- Node.js >= 22.0.0
- LangChain.js >= 1.0.0

## License

MIT
