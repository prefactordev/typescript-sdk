# @prefactor/sdk

Unified SDK for Prefactor observability. This package re-exports everything from `@prefactor/core` and `@prefactor/langchain` for a single-import experience.

## Installation

```bash
npm install @prefactor/sdk
# or
bun add @prefactor/sdk
```

## When to Use This Package

**Use `@prefactor/sdk`** (this package) when:

- You're building a LangChain.js application and want all Prefactor features
- You want a single import for both core primitives and LangChain integration
- You're not concerned about bundle size optimization

**Use individual packages** when:

- You need only core tracing without LangChain (`@prefactor/core`)
- You want to minimize dependencies in a LangChain project (`@prefactor/langchain`)
- You're building a custom framework integration (`@prefactor/core`)

## Quick Start

```typescript
import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { init, shutdown } from '@prefactor/sdk';

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

## What's Included

This package re-exports everything from:

### From `@prefactor/langchain`

- `init()` - Initialize SDK and return middleware
- `shutdown()` - Flush spans and close connections
- `getTracer()` - Get tracer for manual instrumentation
- `PrefactorMiddleware` - LangChain.js middleware class
- `extractTokenUsage()` - Token usage extraction utility

### From `@prefactor/core`

- Configuration: `Config`, `createConfig`, `ConfigSchema`, `HttpTransportConfig`
- Tracing: `Tracer`, `SpanContext`, `Span`, `SpanType`, `SpanStatus`, `TokenUsage`, `ErrorInfo`
- Transports: `Transport`, `StdioTransport`, `HttpTransport`
- Utilities: `getLogger`, `configureLogging`, `serializeValue`, `truncateString`

## Configuration

```typescript
import { init } from '@prefactor/sdk';

// STDIO transport (default, good for development)
const middleware = init();

// HTTP transport (for production)
const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://api.prefactor.ai',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
  },
});
```

## Requirements

- Node.js >= 24.0.0
- LangChain.js >= 1.0.0 (peer dependency)

## Documentation

For detailed documentation, see the [main repository README](https://github.com/prefactor/typescript-sdk).

## License

MIT
