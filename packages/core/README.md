# @prefactor/core

Framework-agnostic observability primitives for Prefactor. This package provides the foundational tracing infrastructure used by framework-specific integrations like `@prefactor/langchain`.

## Installation

```bash
npm install @prefactor/core
# or
bun add @prefactor/core
```

This package is used as a foundation for framework-specific integrations like `@prefactor/langchain` and `@prefactor/ai`.

## When to Use This Package

Use `@prefactor/core` directly when:

- Building a custom integration for a framework not yet supported
- You need manual instrumentation without LangChain.js
- You're implementing your own middleware or transport

For LangChain.js applications, use `@prefactor/langchain` for automatic instrumentation.

## Exports

### Configuration

```typescript
import {
  type Config,
  ConfigSchema,
  createConfig,
  type HttpTransportConfig,
} from '@prefactor/core';

// Create configuration with defaults and environment variables
const config = createConfig({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://api.prefactor.ai',
    apiToken: 'your-token',
  },
});
```

### Tracing

```typescript
import {
  Tracer,
  SpanContext,
  SpanType,
  SpanStatus,
  type Span,
  type TokenUsage,
  type ErrorInfo,
} from '@prefactor/core';
```

### Transports

```typescript
import {
  type Transport,
  StdioTransport,
  HttpTransport,
} from '@prefactor/core';
```

### Utilities

```typescript
import {
  getLogger,
  configureLogging,
  serializeValue,
  truncateString,
} from '@prefactor/core';
```

## Usage

### Manual Instrumentation

```typescript
import {
  Tracer,
  SpanType,
  StdioTransport,
  createConfig,
} from '@prefactor/core';

// Create transport and tracer
const config = createConfig();
const transport = new StdioTransport();
const tracer = new Tracer(transport, config);

// Create a span
const span = tracer.startSpan({
  name: 'my-operation',
  spanType: SpanType.TOOL,
  inputs: { query: 'example' },
  metadata: { service: 'my-service' },
  tags: ['production'],
});

try {
  // Do work...
  const result = await doSomething();

  tracer.endSpan(span, {
    outputs: { result },
  });
} catch (error) {
  tracer.endSpan(span, { error });
}
```

### Context Propagation

The SDK uses Node.js `AsyncLocalStorage` for context propagation. This ensures parent-child relationships are maintained across async boundaries.

```typescript
import { SpanContext, Tracer, SpanType } from '@prefactor/core';

// Run code within a span context
await SpanContext.runAsync(parentSpan, async () => {
  // Child spans automatically inherit from the current context
  const current = SpanContext.getCurrent();
  console.log(current?.spanId); // Parent span ID

  // Create child span with automatic parent linkage
  const childSpan = tracer.startSpan({
    name: 'child-operation',
    spanType: SpanType.TOOL,
    inputs: {},
    parentSpanId: current?.spanId,
    traceId: current?.traceId,
  });
});
```

### Custom Transport

Implement the `Transport` interface to create custom backends:

```typescript
import type { Transport, Span } from '@prefactor/core';

class MyCustomTransport implements Transport {
  async emit(span: Span): Promise<void> {
    // Send span to your backend
    await fetch('https://my-backend.com/spans', {
      method: 'POST',
      body: JSON.stringify(span),
    });
  }

  async flush(): Promise<void> {
    // Ensure all pending spans are sent
  }

  async shutdown(): Promise<void> {
    // Clean up resources
  }
}
```

## Span Types

```typescript
enum SpanType {
  AGENT = 'AGENT',
  LLM = 'LLM',
  TOOL = 'TOOL',
  CHAIN = 'CHAIN',
  RETRIEVER = 'RETRIEVER',
  EMBEDDING = 'EMBEDDING',
  OTHER = 'OTHER',
}
```

## Span Status

```typescript
enum SpanStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}
```

## Requirements

- Node.js >= 24.0.0

## License

MIT
