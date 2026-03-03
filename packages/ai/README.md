# @prefactor/ai

Vercel AI SDK middleware integration for Prefactor observability. Provides automatic tracing of LLM calls, tool executions, and agent workflows via middleware for `wrapLanguageModel`.

## Installation

```bash
npm install @prefactor/ai
# or
bun add @prefactor/ai
```

**Note:** This package requires `@prefactor/core` and `ai` as peer dependencies:

```bash
npm install @prefactor/core ai
# or
bun add @prefactor/core ai
```

## Quick Start

```typescript
import { init } from '@prefactor/core';
import { PrefactorAISDK } from '@prefactor/ai';
import { generateText, wrapLanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const prefactor = init({
  provider: new PrefactorAISDK(),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: '1.0.0',
  },
});

// Wrap your model with the middleware
const model = wrapLanguageModel({
  model: anthropic('claude-3-haiku-20240307'),
  middleware: prefactor.getMiddleware(),
});

// All operations are automatically traced!
const result = await generateText({
  model,
  prompt: 'What is 2+2?',
});

console.log(result.text);

await prefactor.shutdown();
```

## Exports

### Provider

```typescript
import {
  PrefactorAISDK,
  DEFAULT_AI_AGENT_SCHEMA,
} from '@prefactor/ai';
```

### Types

```typescript
import type {
  LanguageModelMiddleware,
  MiddlewareConfig,
} from '@prefactor/ai';
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

- `PREFACTOR_TRANSPORT`: `"http"` (default: `"http"`)
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
import { init } from '@prefactor/core';
import { PrefactorAISDK } from '@prefactor/ai';

const prefactor = init({
  provider: new PrefactorAISDK({
    middleware: { captureContent: false },
  }),
  httpConfig: {
    apiUrl: 'https://app.prefactorai.com',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
    agentIdentifier: '1.0.0',
    agentName: 'My Agent',
    agentDescription: 'An AI agent',
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

For operations not automatically traced, use `prefactor.withSpan(...)` from the core client.

```typescript
await prefactor.withSpan(
  {
    name: 'custom-operation',
    spanType: 'ai-sdk:tool',
    inputs: { data: 'example' },
  },
  async () => doWork()
);
```

## Complete Example with Tools

```typescript
import { init } from '@prefactor/core';
import { PrefactorAISDK } from '@prefactor/ai';
import { generateText, wrapLanguageModel, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const calculatorTool = tool({
  description: 'Perform basic calculations',
  inputSchema: z.object({
    operation: z.enum(['+', '-', '*', '/']),
    a: z.number(),
    b: z.number(),
  }),
  execute: async ({ operation, a, b }) => {
    switch (operation) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b !== 0 ? a / b : 'Error: Division by zero';
    }
  },
});

const prefactor = init({
  provider: new PrefactorAISDK(),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: '1.0.0',
  },
});

const model = wrapLanguageModel({
  model: anthropic('claude-3-haiku-20240307'),
  middleware: prefactor.getMiddleware(),
});

const result = await generateText({
  model,
  prompt: 'Calculate 25 * 4',
  tools: {
    calculator: calculatorTool,
  },
});

console.log(result.text);
await prefactor.shutdown();
```

## Graceful Shutdown

Always call `prefactor.shutdown()` before your application exits to ensure all pending spans are flushed:

```typescript
import { init } from '@prefactor/core';
import { PrefactorAISDK } from '@prefactor/ai';

const prefactor = init({
  provider: new PrefactorAISDK(),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: '1.0.0',
  },
});

process.on('SIGTERM', async () => {
  await prefactor.shutdown();
  process.exit(0);
});
```

## Requirements

- Node.js >= 22.0.0
- AI SDK ^4.0.0 || ^5.0.0 || ^6.0.0

## License

MIT
