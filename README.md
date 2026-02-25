# Prefactor SDK for TypeScript

Automatic observability for LangChain.js agents. Capture distributed traces of LLM calls, tool executions, and agent workflows with minimal integration effort.

## Features

- Automatic tracing of LLM calls with token usage
- Tool execution tracking
- Agent workflow visualization
- Parent-child span relationships
- Error tracking and debugging
- Zero-overhead instrumentation
- TypeScript type safety
- Supports stdio and HTTP transports

## Monorepo Structure

This repository is a Bun monorepo containing three packages:

| Package | Description |
|---------|-------------|
| [`@prefactor/core`](./packages/core/) | Framework-agnostic observability primitives |
| [`@prefactor/langchain`](./packages/langchain/) | LangChain.js integration |
| [`@prefactor/ai`](./packages/ai/) | Vercel AI SDK integration |

Install `@prefactor/core` along with the adapter package for your framework.

## Installation

### For LangChain.js users:

```bash
npm install @prefactor/core @prefactor/langchain
# or
bun add @prefactor/core @prefactor/langchain
```

### For Vercel AI SDK users:

```bash
npm install @prefactor/core @prefactor/ai
# or
bun add @prefactor/core @prefactor/ai
```

## Quick Start

### For LangChain.js users:

```typescript
import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { init, shutdown } from '@prefactor/langchain';

// Initialize Prefactor (defaults to stdio transport)
const middleware = init();

// Create your agent with middleware
const agent = createAgent({
  model: 'claude-sonnet-4-5-20250929',
  tools: [],
  systemPrompt: 'You are a helpful assistant.',
  middleware: [middleware],
});
// All operations are automatically traced!
const result = await agent.invoke({
  messages: [{ role: 'user', content: 'What is 2+2?' }],
});

console.log(result.messages[result.messages.length - 1].content);

// Graceful shutdown
await shutdown();
```

Refer to the [Langchain specific documentation](./packages/langchain/README.md) for more details.

### For Vercel AI SDK users:

```typescript
import { init, shutdown } from '@prefactor/ai';
import { generateText, wrapLanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

// Initialize Prefactor
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

Refer to the [Vercel AI SDK specific documentation](./packages/ai/README.md) for more details.

## Configuration

### Environment Variables

The SDK can be configured using environment variables:

- `PREFACTOR_TRANSPORT`: `"stdio"` | `"http"` (default: `"stdio"`)
- `PREFACTOR_API_URL`: API endpoint for HTTP transport
- `PREFACTOR_API_TOKEN`: Authentication token for HTTP transport
- `PREFACTOR_SAMPLE_RATE`: Sampling rate 0.0-1.0 (default: `1.0`)
- `PREFACTOR_CAPTURE_INPUTS`: Capture span inputs (default: `true`)
- `PREFACTOR_CAPTURE_OUTPUTS`: Capture span outputs (default: `true`)
- `PREFACTOR_MAX_INPUT_LENGTH`: Max input string length (default: `10000`)
- `PREFACTOR_MAX_OUTPUT_LENGTH`: Max output string length (default: `10000`)
- `PREFACTOR_LOG_LEVEL`: `"debug"` | `"info"` | `"warn"` | `"error"` (default: `"info"`)

### Programmatic Configuration

```typescript
import { init } from '@prefactor/langchain';

// HTTP Transport
const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://app.prefactorai.com',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
    agentIdentifier: '1.0.0',
  },
});

// Custom sampling
const middleware = init({
  sampleRate: 0.1, // Sample 10% of traces
  maxInputLength: 5000,
  maxOutputLength: 5000,
});
```

## Transports

### STDIO Transport (Default)

The STDIO transport writes spans as newline-delimited JSON to stdout. This is useful for local development and piping to other tools.

```typescript
import { init } from '@prefactor/langchain';

const middleware = init(); // Uses stdio by default
```

### HTTP Transport

The HTTP transport sends spans to a remote API endpoint with retry logic and queue-based processing.

```typescript
import { init } from '@prefactor/langchain';

const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://app.prefactorai.com',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
    agentIdentifier: '1.0.0',
    maxRetries: 3,
    requestTimeout: 30000,
  },
});
```

## API Reference

### `@prefactor/langchain`

#### `init(config?: Partial<Config>): AgentMiddleware`

Initialize the SDK and return middleware instance for LangChain.js.

**Parameters:**
- `config` - Optional configuration object

**Returns:**
- `AgentMiddleware` - Middleware instance for use with LangChain.js agents

**Example:**
```typescript
import { init } from '@prefactor/langchain';

const middleware = init({
  transportType: 'stdio',
  sampleRate: 1.0,
});
```

### `@prefactor/ai`

#### `init(config?: Partial<Config>, middlewareConfig?: MiddlewareConfig): LanguageModelMiddleware`

Initialize the SDK and return middleware instance for Vercel AI SDK.

**Parameters:**
- `config` - Optional configuration object for transport settings
- `middlewareConfig` - Optional middleware-specific configuration (e.g., `captureContent`)

**Returns:**
- `LanguageModelMiddleware` - Middleware instance for use with `wrapLanguageModel`

**Example:**
```typescript
import { init } from '@prefactor/ai';

const middleware = init(
  { transportType: 'stdio' },
  { captureContent: false }
);
```

### `shutdown(): Promise<void>`

Flush pending spans and close connections. Call before application exit.

**Example:**
```typescript
import { shutdown } from '@prefactor/langchain';

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});
```

### `getTracer(): Tracer`

Get the global tracer instance for manual instrumentation.

**Returns:**
- `Tracer` - Tracer instance

**Example:**
```typescript
import { getTracer, SpanType } from '@prefactor/langchain';

const tracer = getTracer();
const span = tracer.startSpan({
  name: 'custom-operation',
  spanType: SpanType.TOOL,
  inputs: { data: 'example' },
});

try {
  // ... do work ...
  tracer.endSpan(span, { outputs: { result: 'done' } });
} catch (error) {
  tracer.endSpan(span, { error });
}
```

## Advanced Usage

### Manual Instrumentation

For operations not automatically traced by the middleware:

```typescript
import { getTracer, SpanType } from '@prefactor/langchain';

const tracer = getTracer();

const span = tracer.startSpan({
  name: 'database-query',
  spanType: SpanType.TOOL,
  inputs: { query: 'SELECT * FROM users' },
  metadata: { database: 'postgres' },
  tags: ['database', 'query'],
});

try {
  const result = await db.query('SELECT * FROM users');
  tracer.endSpan(span, { outputs: { rowCount: result.rows.length } });
} catch (error) {
  tracer.endSpan(span, { error });
}
```

### Context Propagation

The SDK automatically propagates span context through async operations using Node.js AsyncLocalStorage. Child spans automatically inherit the trace ID and parent span ID from the current context.

```typescript
import { SpanContext } from '@prefactor/langchain';

// Get the current span (if any)
const currentSpan = SpanContext.getCurrent();

// Child spans automatically use the current span as parent
const child = tracer.startSpan({
  name: 'child-operation',
  spanType: SpanType.TOOL,
  inputs: {},
  parentSpanId: currentSpan?.spanId,
  traceId: currentSpan?.traceId,
});
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions:

```typescript
import type {
  Config,
  HttpTransportConfig,
  Span,
  SpanType,
  SpanStatus,
  TokenUsage,
  ErrorInfo
} from '@prefactor/langchain';

const config: Config = {
  transportType: 'stdio',
  sampleRate: 1.0,
  captureInputs: true,
  captureOutputs: true,
};
```

## Examples

See the `examples/` directory for complete examples:

- [`examples/basic.ts`](./examples/basic.ts) - Simple LangChain.js agent with stdio transport
- [`examples/anthropic-agent/simple-agent.ts`](./examples/anthropic-agent/simple-agent.ts) - Full working example with Anthropic Claude
- [`examples/ai-sdk/simple-agent.ts`](./examples/ai-sdk/simple-agent.ts) - Vercel AI SDK example with tools

## Skills

This repo includes reusable skills for coding tools and AI agents.

### Install via skills CLI (recommended)

```bash
# Install skills from this repository
bunx skills add https://github.com/prefactordev/typescript-sdk/
```

### LLM instructions (Copy/Paste)

Use this when a tool does not support direct skills installation yet:

```text
Clone the skills repo to a temporary folder, copy the skill folders, then delete the clone.

1) git clone https://github.com/prefactordev/typescript-sdk /tmp/prefactor-skills
2) Copy the folders into your coding tool's local skills directory:
   - /tmp/prefactor-skills/skills
3) Delete the temporary clone:
   rm -rf /tmp/prefactor-skills
```

## Architecture

The SDK consists of five main layers:

1. **Tracing Layer**: Span data models, Tracer for lifecycle management, Context propagation
2. **Transport Layer**: Pluggable backends (stdio, HTTP) for span emission
3. **Instrumentation Layer**: LangChain.js and Vercel AI SDK middleware integrations
4. **Configuration**: Environment variable support, validation with Zod
5. **Utilities**: Logging, serialization helpers

## Requirements

- Node.js >= 22.0.0
- TypeScript >= 5.0.0 (for TypeScript projects)
- Bun >= 1.0.0 (optional, for development)
- LangChain.js >= 1.0.0 (peer dependency for `@prefactor/langchain`)
- AI SDK ^4.0.0 || ^5.0.0 || ^6.0.0 (peer dependency for `@prefactor/ai`)

## Development

This project uses Bun with mise for toolchain management.

```bash
# Install toolchain
mise install

# Install dependencies (monorepo-wide)
just install
```

```bash
# Build all packages
just build

# Run tests
just test

# Type check
just typecheck

# Lint
just lint

# Format
just format

# Run all checks (typecheck + lint + test)
just check

# Clean build artifacts
just clean
```

### Per-Package Commands

```bash
# Build a specific package
bun --filter @prefactor/core build

# Run tests for a specific package
bun test packages/core/tests/
```

## License

MIT

## Support

- Documentation: [https://app.prefactorai.com](https://app.prefactorai.com)
- Issues: [GitHub Issues](https://github.com/prefactordev/typescript-sdk/issues)
- Email: support@prefactor.ai
