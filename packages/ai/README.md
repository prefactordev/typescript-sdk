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
import { init, shutdown } from '@prefactor/ai';
import { generateText, wrapLanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

// Initialize Prefactor (defaults to stdio transport)
const middleware = init();

// Wrap your model with the middleware
const model = wrapLanguageModel({
  model: anthropic('claude-3-haiku-20240307'),
  middleware,
});

// All operations are automatically traced!
const result = await generateText({
  model,
  prompt: 'What is 2+2?',
});

console.log(result.text);

// Graceful shutdown
await shutdown();
```

## Exports

### Main Entry Points

```typescript
import {
  init,                   // Initialize SDK and return middleware
  shutdown,              // Flush spans and close connections
  getTracer,             // Get tracer for manual instrumentation
} from '@prefactor/ai';
```

### Middleware

```typescript
import { createPrefactorMiddleware } from '@prefactor/ai';
```

### Types

```typescript
import type {
  CallData,
  MiddlewareConfig,
} from '@prefactor/ai';
```

### Re-exports from @prefactor/core

For convenience, common types are re-exported:

```typescript
import {
  type Config,
  type CoreRuntime,
  type ErrorInfo,
  type HttpTransportConfig,
  type Span,
  type TokenUsage,
  SpanStatus,
  SpanType,
} from '@prefactor/ai';
```

## Configuration

### Environment Variables

The SDK can be configured using environment variables:

- `PREFACTOR_TRANSPORT`: `"stdio"` | `"http"` (default: `"stdio"`)
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
import { init } from '@prefactor/ai';

// STDIO transport (default)
const middleware = init();

// HTTP transport
const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://api.prefactor.ai',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
    agentIdentifier: '1.0.0',
    agentName: 'My Agent',
    agentDescription: 'An AI agent',
  },
});

// With middleware-specific configuration
const middleware = init(
  { transportType: 'stdio' },
  { captureContent: false } // Don't capture prompts/responses
);
```

## What Gets Traced

The middleware automatically captures:

- **LLM Calls**: Model name, inputs, outputs, token usage
- **Tool Executions**: Tool name, inputs, outputs, duration
- **Agent Operations**: Full workflow with parent-child relationships
- **Errors**: Stack traces and error messages

## Manual Instrumentation

For operations not automatically traced:

```typescript
import { getTracer, SpanType } from '@prefactor/ai';

const tracer = getTracer();

const span = tracer.startSpan({
  name: 'custom-operation',
  spanType: SpanType.TOOL,
  inputs: { data: 'example' },
});

try {
  const result = await doWork();
  tracer.endSpan(span, { outputs: { result } });
} catch (error) {
  tracer.endSpan(span, { error });
}
```

## Complete Example with Tools

```typescript
import { init, shutdown } from '@prefactor/ai';
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

const middleware = init();

const model = wrapLanguageModel({
  model: anthropic('claude-3-haiku-20240307'),
  middleware,
});

const result = await generateText({
  model,
  prompt: 'Calculate 25 * 4',
  tools: {
    calculator: calculatorTool,
  },
});

console.log(result.text);
await shutdown();
```

## Graceful Shutdown

Always call `shutdown()` before your application exits to ensure all pending spans are flushed:

```typescript
import { shutdown } from '@prefactor/ai';

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});
```

## Requirements

- Node.js >= 24.0.0
- AI SDK ^4.0.0 || ^5.0.0

## License

MIT
