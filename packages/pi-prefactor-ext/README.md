# @prefactor/pi-prefactor-ext

Prefactor instrumentation extension for the pi coding agent. Provides automatic tracing of agent lifecycle events including sessions, user interactions, agent runs, turns, and tool calls.

## Status

**Planning phase** - See `PLAN.md` for implementation details.

## Overview

This extension hooks into pi's lifecycle events to create a hierarchical span structure for distributed tracing in Prefactor. The span hierarchy follows:

```
session (24hr lifetime, root span)
  └─ user_interaction (5min idle timeout)
      ├─ user_message (instant, auto-closed)
      ├─ agent_run (child of interaction)
      │   ├─ turn (LLM response cycle)
      │   │   ├─ tool_call (concurrent, children of turn)
      │   │   └─ tool_call
      │   └─ turn
      └─ assistant_response (instant, auto-closed)
```

## Hook Handlers

The extension registers ~23 hooks that automatically create and manage spans:

| Category | Hooks |
|----------|-------|
| **Session** | `session_start`, `session_shutdown`, `session_before_switch`, `session_before_compact`, `session_compact` |
| **Agent** | `before_agent_start`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `context` |
| **Tools** | `tool_call`, `tool_result`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end` |
| **Messages** | `input`, `message_start`, `message_update`, `message_end` |
| **Provider** | `before_provider_request`, `model_select` |
| **Resources** | `resources_discover` |

## Span Types

| Span Type | Description |
|-----------|-------------|
| `pi:session` | Root span for pi session (24hr lifetime) |
| `pi:user_interaction` | User interaction context (5min idle timeout) |
| `pi:user_message` | Inbound user message event |
| `pi:agent_run` | Agent execution run (may contain multiple turns) |
| `pi:turn` | Single LLM response + tool call cycle |
| `pi:tool_call` | Tool execution (supports concurrent calls) |
| `pi:assistant_response` | Assistant response event |
| `pi:agent_thinking` | Agent thinking/reasoning content |

## Installation

```bash
# Copy to global extensions
cp -r packages/pi-prefactor-ext ~/.pi/agent/extensions/pi-prefactor

# Or project-local
cp -r packages/pi-prefactor-ext .pi/extensions/pi-prefactor
```

## Configuration

Set environment variables or configure via pi settings:

```bash
export PREFACTOR_API_URL=https://app.prefactorai.com
export PREFACTOR_API_TOKEN=your-token
export PREFACTOR_AGENT_ID=your-agent-id
```

Or in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "id": "pi-prefactor",
      "config": {
        "apiUrl": "https://app.prefactorai.com",
        "apiToken": "your-token",
        "agentId": "your-agent-id",
        "agentName": "Pi Agent",
        "logLevel": "info"
      }
    }
  ]
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiUrl` | string | - | Prefactor API URL |
| `apiToken` | string | - | Prefactor API token |
| `agentId` | string | - | Agent ID in Prefactor |
| `agentName` | string | "Pi Agent" | Human-readable name |
| `agentVersion` | string | "default" | Version suffix |
| `logLevel` | string | "info" | debug/info/warn/error |
| `userInteractionTimeoutMinutes` | number | 5 | Interaction span timeout |
| `sessionTimeoutHours` | number | 24 | Session span timeout |
| `captureThinking` | boolean | true | Capture thinking blocks |
| `captureToolInputs` | boolean | true | Capture tool inputs |
| `captureToolOutputs` | boolean | true | Capture tool outputs |

## Usage

Once installed and configured, the extension automatically instruments:

1. **User messages** - Each prompt creates a user_message span
2. **Agent runs** - Full agent processing cycle
3. **Turns** - Individual LLM response + tool call cycles
4. **Tool calls** - All built-in and custom tool executions
5. **Assistant responses** - Final response text
6. **Thinking** - Reasoning content (when enabled)

## Architecture

See `PLAN.md` for detailed implementation plan and `HOOK-MAPPING.md` for hook-by-hook implementation reference.

### Key Components

- **index.ts** - Plugin entry point, hook registrations
- **agent.ts** - HTTP client for Prefactor API (span CRUD, instance lifecycle)
- **session-state.ts** - Manages span hierarchy and timeouts per session
- **logger.ts** - Structured logger for diagnostics
- **tool-definitions.ts** - Pi tool name mappings and schemas
- **tool-span-contract.ts** - Tool span schema builders
- **data-risk-config.ts** - GDPR-style risk configs per span type

### Dependencies

- `@prefactor/core` - HTTP client, span types
- `@mariozechner/pi-coding-agent` - Extension API (dev dependency for types)
- `zod` - Configuration validation

## Development

```bash
# Install dependencies
bun install

# Build (if needed, extensions load via jiti)
bun run build

# Test with pi
pi -e ./src/index.ts
```

## Testing

1. Configure Prefactor API credentials
2. Install extension in `~/.pi/agent/extensions/`
3. Run pi interactively
4. Verify spans appear in Prefactor UI
5. Check logs for errors

## Differences from OpenClaw Plugin

| Aspect | OpenClaw | Pi |
|--------|----------|-----|
| Plugin API | `OpenClawPluginApi` | `ExtensionAPI` |
| Event hooks | 24 specific | ~23 (different names) |
| Agent model | Single agent_run | Multiple turns per agent_run |
| LLM events | `llm_input`, `llm_output` | `before_provider_request`, `turn_end` |
| Tool execution | Sequential | Concurrent |
| Loading | Compiled plugin | TypeScript (jiti) |

## License

Same as parent repository
