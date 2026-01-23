# @prefactor/ai

Vercel AI SDK-compatible adapter for the Vercel AI SDK that sends telemetry to the Prefactor platform.

This package bridges the Vercel AI SDK's `experimental_telemetry` feature with Prefactor's tracing infrastructure, enabling automatic observability of AI operations.

## Installation

```bash
bun add @prefactor/ai
```

## Quick Start

```typescript
import { init, shutdown } from '@prefactor/ai';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

// Initialize with stdio transport (development)
const tracer = init();

// Or with HTTP transport (production)
const tracer = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://api.prefactor.ai',
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentId: process.env.PREFACTOR_AGENT_ID,
  },
});

// Use with AI SDK
const result = await generateText({
  model: anthropic('claude-haiku-4-5'),
  prompt: 'Hello!',
  experimental_telemetry: {
    isEnabled: true,
    tracer,
  },
});

// Shutdown when done
await shutdown();
```

## Configuration

### Using Environment Variables

```bash
# Transport selection
export PREFACTOR_TRANSPORT=http  # or 'stdio'

# HTTP transport config
export PREFACTOR_API_URL=https://api.prefactor.ai
export PREFACTOR_API_TOKEN=your-token
export PREFACTOR_AGENT_ID=your-agent-id  # optional
```

### Programmatic Configuration

```typescript
import { init } from '@prefactor/ai';

const tracer = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://api.prefactor.ai',
    apiToken: 'your-token',
    agentId: 'your-agent-id',
    // Optional settings
    requestTimeout: 30000,
    maxRetries: 3,
  },
  // Optional capture settings
  captureInputs: true,
  captureOutputs: true,
  sampleRate: 1.0,
});
```

## Span Type Mapping

The adapter automatically maps AI SDK span names to Prefactor span types:

| AI SDK Operation | Prefactor SpanType |
|------------------|-------------------|
| `ai.generateText*` | LLM |
| `ai.streamText*` | LLM |
| `ai.generateObject*` | LLM |
| `ai.streamObject*` | LLM |
| `ai.toolCall.*` | TOOL |
| `ai.embed*` | LLM |
| Other | CHAIN |

## Attribute Handling

OTEL attributes from the AI SDK are categorized automatically:

- **Inputs**: `ai.prompt`, `ai.model.id`, `ai.model.provider`, settings
- **Outputs**: `ai.response.text`, `ai.finishReason`, etc.
- **Token Usage**: `ai.usage.promptTokens`, `ai.usage.completionTokens`
- **Metadata**: All other attributes

## API Reference

### `init(config?: Partial<Config>): AiTracer`

Initialize the SDK and return an OTEL-compatible tracer.

### `getTracer(): AiTracer`

Get the current tracer instance. Calls `init()` if not initialized.

### `shutdown(): Promise<void>`

Shutdown the SDK and flush pending spans.

## Related Packages

- `@prefactor/core` - Core tracing infrastructure
- `@prefactor/langchain` - LangChain.js integration
- `@prefactor/sdk` - Unified SDK re-exporting all packages

## License

MIT
