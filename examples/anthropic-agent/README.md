# Anthropic Agent Example

This example demonstrates end-to-end tracing of a LangChain.js agent using Anthropic's Claude model with the Prefactor SDK. It serves as a smoke test to verify that the SDK correctly captures agent operations including LLM calls, tool executions, and agent workflows.

## Purpose

- **End-to-End Validation**: Proves the Prefactor SDK works with Anthropic's Claude models
- **Smoke Test**: Can be run to verify SDK functionality after changes
- **Real API Usage**: Uses the live Anthropic API (no mocking)
- **Simple Example**: Demonstrates basic agent functionality with 2 simple tools

## Prerequisites

- Node.js 18 or higher (or Bun runtime)
- Anthropic API key
- Dependencies installed

## Setup

### 1. Install Dependencies

From the repository root:

```bash
bun install
# or: npm install
```

This will install the Prefactor SDK along with:
- `langchain` - LangChain v1 with built-in agent creation and model integrations

### 2. Set Environment Variables

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=your_api_key_here
```

Optionally configure Prefactor settings:

```bash
export PREFACTOR_API_URL=http://localhost:8000
export PREFACTOR_API_TOKEN=your_token_here
export PREFACTOR_AGENT_ID=your_agent_id_here
```

Or create a `.env` file in the `examples/` directory (see `.env.example`).

## Running the Example

From the repository root:

```bash
# Using Bun
bun examples/anthropic-agent/simple-agent.ts

# Using Node.js (after building)
bun run build
node dist/examples/anthropic-agent/simple-agent.js
```

Toolchain setup:

```bash
mise install
```

## Expected Output

When you run the example, you'll see:

1. **Initialization Messages**: Confirming the SDK and model are set up
2. **Agent Interactions**: Two example interactions showing the agent using tools
3. **Trace Spans**: Spans sent to the Prefactor API (HTTP transport)

### Example Interaction Output

```
================================================================================
Example 1: Getting Current Time
================================================================================

Agent Response:
The current date and time is 2026-01-20 10:30:45
```

### Trace Spans

The SDK sends trace spans to the Prefactor API via HTTP transport. Each span represents an operation in your agent:

- **AGENT**: Root agent execution span for each invocation
- **LLM**: Claude API calls with token usage information
- **TOOL**: Tool executions (calculator, get_current_time)

## Understanding the Traces

### Span Types

You should see three types of spans in the Prefactor UI:

1. **AGENT**: Represents the agent execution from `createAgent`
   - Top-level span for each agent invocation
   - Contains other spans as children

2. **LLM**: Represents calls to Claude
   - Includes `token_usage` field with prompt_tokens, completion_tokens, and total_tokens
   - Shows the model's reasoning and decision-making

3. **TOOL**: Represents tool executions
   - One span for each tool call (calculator, get_current_time)
   - Shows tool input and output

### Span Hierarchy

Spans are organized in a parent-child hierarchy:

- The `trace_id` field groups all spans from a single agent invocation
- The `parent_span_id` field links child spans to their parent
- Example hierarchy:
  ```
  AGENT (agent execution)
  ├── LLM (initial reasoning)
  ├── TOOL (get_current_time)
  └── LLM (final response)
  ```

### Token Usage

LLM spans include token usage information:

```typescript
{
  "span_type": "llm",
  "token_usage": {
    "prompt_tokens": 150,
    "completion_tokens": 25,
    "total_tokens": 175
  }
}
```

This helps you track API costs and model usage.

## Tools in This Example

### 1. Calculator Tool
- Evaluates simple mathematical expressions
- Example: "What is 42 multiplied by 17?"

### 2. Time Tool
- Returns the current date and time
- Example: "What is the current date and time?"

## Model Details

This example uses `claude-haiku-4-5-20251001`, which is:
- The latest Claude Haiku model
- Fast and cost-effective
- Supports native tool calling
- Good for smoke testing

## Validation Checklist

The example validates that:
- ✅ LLM spans are created for Claude API calls
- ✅ Tool spans are created for tool executions
- ✅ Agent spans are created for agent operations
- ✅ Parent-child relationships are correct (nested spans)
- ✅ Token usage is captured for Claude calls
- ✅ All spans have proper trace_id grouping
- ✅ PFID generation works correctly

## Troubleshooting

### Missing API Key

```
Error: ANTHROPIC_API_KEY environment variable is required.
```

**Solution**: Set the `ANTHROPIC_API_KEY` environment variable.

### Import Errors

```
ModuleNotFoundError: No module named '@langchain/anthropic'
```

**Solution**: Install dependencies with `bun install` or `npm install`

### Connection Errors

If you see HTTP connection errors to the Prefactor API:
- Check that `PREFACTOR_API_URL` is set correctly
- Verify the Prefactor API is running (if using local instance)
- Check your `PREFACTOR_API_TOKEN` is valid

### No Trace Output

If you don't see traces in the Prefactor UI:
- Verify the Prefactor SDK is properly initialized
- Check the middleware is passed to the agent
- Look for any error messages in the console
- Ensure the shutdown() call completes (flushes pending spans)

## Next Steps

- Try adding your own custom tools
- Experiment with different Claude models (Sonnet, Opus)
- Use the traces to analyze agent performance and costs
- Integrate with your own LangChain.js applications
