# @prefactor/langchain

LangChain.js integration for Prefactor observability. Provides automatic tracing of LLM calls, tool executions, and agent workflows with minimal setup.

## Installation

```bash
npm install @prefactor/langchain
# or
bun add @prefactor/langchain
```

Most users should install `@prefactor/sdk` instead, which bundles both `@prefactor/core` and `@prefactor/langchain`.

## Peer Dependencies

This package requires LangChain.js v1.0.0 or later:

```bash
npm install langchain@^1.0.0
```

## Quick Start

```typescript
import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { init, shutdown } from '@prefactor/langchain';

// Initialize Prefactor
const middleware = init();

// Create agent with middleware
const agent = createAgent({
  model: 'claude-sonnet-4-5-20250929',
  tools: [],
  systemPrompt: 'You are a helpful assistant.',
  middleware: [middleware],
});

// All operations are automatically traced
const result = await agent.invoke({
  messages: [{ role: 'user', content: 'Hello!' }],
});

// Graceful shutdown
await shutdown();
```

## Exports

### Main Entry Points

```typescript
import {
  init,        // Initialize SDK and return middleware
  shutdown,    // Flush spans and close connections
  getTracer,   // Get tracer for manual instrumentation
} from '@prefactor/langchain';
```

### Middleware

```typescript
import { PrefactorMiddleware } from '@prefactor/langchain';
```

### Utilities

```typescript
import { extractTokenUsage } from '@prefactor/langchain';
```

### Re-exports from @prefactor/core

For convenience, common types are re-exported:

```typescript
import {
  type Config,
  type HttpTransportConfig,
  type Span,
  SpanStatus,
  SpanType,
} from '@prefactor/langchain';
```

## Configuration

### Environment Variables

- `PREFACTOR_TRANSPORT`: `"stdio"` | `"http"` (default: `"stdio"`)
- `PREFACTOR_API_URL`: API endpoint for HTTP transport
- `PREFACTOR_API_TOKEN`: Authentication token
- `PREFACTOR_SAMPLE_RATE`: Sampling rate 0.0-1.0 (default: `1.0`)

### Programmatic Configuration

```typescript
import { init } from '@prefactor/langchain';

// STDIO transport (default)
const middleware = init();

// HTTP transport
const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://api.prefactor.ai',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
    agentVersion: '1.0.0',
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

For operations not automatically traced:

```typescript
import { getTracer, SpanType } from '@prefactor/langchain';

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

## Graceful Shutdown

Always call `shutdown()` before your application exits to ensure all pending spans are flushed:

```typescript
import { shutdown } from '@prefactor/langchain';

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});
```

## Requirements

- Node.js >= 24.0.0
- LangChain.js >= 1.0.0

## License

MIT
