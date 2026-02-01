# Vercel AI SDK Example with @prefactor/ai

This example demonstrates how to use `@prefactor/ai` to send telemetry from the Vercel AI SDK to the Prefactor platform.

## Prerequisites

- Bun runtime
- `ANTHROPIC_API_KEY` environment variable set

## Running the Example

### Local Development (stdio transport)

For local development, telemetry is output to stdout:

```bash
# From the repository root
ANTHROPIC_API_KEY=your-key bun run example:ai-sdk
```

### Production (HTTP transport to Prefactor)

To send telemetry to the Prefactor platform:

```bash
export ANTHROPIC_API_KEY=your-anthropic-key
export PREFACTOR_API_URL=https://api.prefactor.ai
export PREFACTOR_API_TOKEN=your-prefactor-token
export PREFACTOR_AGENT_ID=your-agent-id  # optional
export PREFACTOR_AGENT_VERSION=1.0.0     # optional

bun run example:ai-sdk
```

## What it Does

The example creates three test scenarios:

1. **Getting Current Time** - Uses a time tool to get the current date/time
2. **Simple Calculation** - Uses a calculator tool to evaluate a math expression
3. **Multi-turn with Multiple Tools** - Combines both tools in a single request

## Telemetry Output

### Stdio Transport (Development)

When running locally without Prefactor credentials, spans are output to stdout:

```
[span] name=ai.generateText type=llm trace=abc123...
  inputs: { ai.model.id: "claude-haiku-4-5", ai.prompt: "..." }
  outputs: { ai.response.text: "..." }
  tokenUsage: { promptTokens: 150, completionTokens: 42 }
```

### HTTP Transport (Production)

When PREFACTOR_API_URL and PREFACTOR_API_TOKEN are set, spans are sent to the Prefactor platform where you can:

- View traces in the dashboard
- Analyze LLM performance
- Monitor tool usage
- Debug agent behavior

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Yes |
| `PREFACTOR_API_URL` | Prefactor API endpoint | For HTTP |
| `PREFACTOR_API_TOKEN` | Prefactor API token | For HTTP |
| `PREFACTOR_AGENT_ID` | Agent identifier (pfid) | Optional |
| `PREFACTOR_AGENT_VERSION` | Agent version | Optional |

### Programmatic Configuration

```typescript
import { init } from '@prefactor/ai';

// stdio transport (development)
const tracer = init();

// HTTP transport (production)
const tracer = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: 'https://api.prefactor.ai',
    apiToken: 'your-token',
    agentId: 'your-agent-id',
    agentVersion: '1.0.0',
  },
});
```

## Span Types

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

## Files

- `simple-agent.ts` - Main example demonstrating generateText with tools
