# Prefactor SDK for TypeScript

Automatic observability for LangChain.js agents. Capture distributed traces of LLM calls, tool executions, and agent workflows with minimal integration effort.

## Features

- ✅ Automatic tracing of LLM calls with token usage
- ✅ Tool execution tracking
- ✅ Agent workflow visualization
- ✅ Parent-child span relationships
- ✅ Error tracking and debugging
- ✅ Zero-overhead instrumentation
- ✅ TypeScript type safety
- ✅ Supports stdio and HTTP transports

## Installation

```bash
npm install @prefactor/sdk
# or
bun add @prefactor/sdk
```

## Quick Start

```typescript
import { init } from '@prefactor/sdk';
import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

// Initialize Prefactor (defaults to stdio transport)
const middleware = init();

// Create your agent with middleware
const model = new ChatAnthropic({ model: 'claude-sonnet-4-5-20250929' });
const agent = createReactAgent({
  llm: model,
  tools: [],
  middleware: [middleware],
});

// All operations are automatically traced!
const result = await agent.invoke({
  messages: [{ role: 'user', content: 'What is 2+2?' }],
});

console.log(result.messages[result.messages.length - 1].content);
```

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
import { init } from '@prefactor/sdk';

// HTTP Transport
const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://api.prefactor.ai',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
    agentVersion: '1.0.0',
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
import { init } from '@prefactor/sdk';

const middleware = init(); // Uses stdio by default
```

### HTTP Transport

The HTTP transport sends spans to a remote API endpoint with retry logic and queue-based processing.

```typescript
import { init } from '@prefactor/sdk';

const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://api.prefactor.ai',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: 'my-agent',
    agentVersion: '1.0.0',
    maxRetries: 3,
    requestTimeout: 30000,
  },
});
```

## API Reference

### `init(config?: Partial<Config>): PrefactorMiddleware`

Initialize the SDK and return middleware instance.

**Parameters:**
- `config` - Optional configuration object

**Returns:**
- `PrefactorMiddleware` - Middleware instance to use with LangChain.js agents

**Example:**
```typescript
const middleware = init({
  transportType: 'stdio',
  sampleRate: 1.0,
});
```

### `shutdown(): Promise<void>`

Flush pending spans and close connections. Call before application exit.

**Example:**
```typescript
import { shutdown } from '@prefactor/sdk';

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
import { getTracer, SpanType } from '@prefactor/sdk';

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
import { getTracer, SpanType } from '@prefactor/sdk';

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
import { SpanContext } from '@prefactor/sdk';

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
} from '@prefactor/sdk';

const config: Config = {
  transportType: 'stdio',
  sampleRate: 1.0,
  captureInputs: true,
  captureOutputs: true,
};
```

## Examples

See the `examples/` directory for complete examples:

- `examples/basic.ts` - Simple LangChain.js agent with stdio transport
- `examples/http-transport.ts` - Using HTTP transport
- `examples/custom-tools.ts` - Tracing custom tools
- `examples/manual-instrumentation.ts` - Manual span creation

## Architecture

The SDK consists of five main layers:

1. **Tracing Layer**: Span data models, Tracer for lifecycle management, Context propagation
2. **Transport Layer**: Pluggable backends (stdio, HTTP) for span emission
3. **Instrumentation Layer**: LangChain.js middleware integration
4. **Configuration**: Environment variable support, validation with Zod
5. **Utilities**: Logging, serialization helpers

For more details, see `docs/architecture.md`.

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0.0 (for TypeScript projects)
- Bun >= 1.0.0 (optional, for development)

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Lint
bun run lint

# Format
bun run format

# Build
bun run build
```

## Contributing

Contributions are welcome! Please see `CONTRIBUTING.md` for guidelines.

## License

MIT

## Support

- Documentation: [https://docs.prefactor.ai](https://docs.prefactor.ai)
- Issues: [GitHub Issues](https://github.com/prefactor/typescript-sdk/issues)
- Email: support@prefactor.ai
