# Agent Instructions - Prefactor OpenClaw Plugin

## Project Overview
This is a TypeScript plugin for OpenClaw (`@prefactor/openclaw`) that hooks into lifecycle events to create distributed traces via the Prefactor API. It tracks spans in a hierarchy: `session > user_interaction > {user_message, agent_run > tool_call, assistant_response}`.

Part of the `@prefactor/typescript-sdk` monorepo. Depends on `@prefactor/core` for HTTP clients (`AgentInstanceClient`, `AgentSpanClient`, `HttpClient`).

## Build/Lint/Test Commands

This project uses `mise` as the task runner and `bun` as the runtime.

```bash
# From repo root
mise install          # Install toolchain (bun, node)
mise build-openclaw   # Build ESM + CJS bundles
mise typecheck        # Type check all packages (tsc --build)
mise lint             # Lint with Biome
mise build            # Build all packages

# No test framework configured yet - manual testing via OpenClaw
```

## Source Files

```
packages/openclaw/src/
  index.ts          # Plugin entry point - registers 14 hooks via api.on()
  agent.ts          # HTTP client for Prefactor API (span CRUD, instance lifecycle)
  session-state.ts  # Span hierarchy state management with per-session operation queue
  logger.ts         # Structured logger with [prefactor:<event>] prefix
```

## Architecture

### Three Layers

1. **Hook handlers** (`index.ts`): Registered via `api.on('hook_name', handler)` using the `OpenClawPluginApi` from `openclaw/plugin-sdk`. Handlers are fire-and-forget (`.catch()` pattern) since hooks cannot be async.

2. **SessionStateManager** (`session-state.ts`): Owns the span hierarchy. Tracks span IDs via flat fields (`sessionSpanId`, `interactionSpanId`, `agentRunSpanId`, `toolCallSpans[]`). All public methods are serialized per session key via `SessionOperationQueue` to prevent race conditions between hooks.

3. **Agent** (`agent.ts`): Pure HTTP client. Calls `@prefactor/core` clients (`AgentSpanClient.create()`, `.finish()`, `AgentInstanceClient.register()`, `.start()`, `.finish()`). Has a `ReplayQueue` for retrying failed operations. Does NOT manage span hierarchy.

### Span Hierarchy
```
session (24hr lifetime, root span)
  └─ user_interaction (5min idle timeout)
      ├─ user_message (instant, auto-closed)
      ├─ agent_run (child of interaction)
      │   ├─ tool_call (concurrent, children of agent_run)
      │   └─ tool_call
      └─ assistant_response (instant, auto-closed)
```

### Hook Event Flow

For each user message, hooks fire in this order:
```
message_received  → buffers message (no sessionKey available)
before_agent_start → creates user_message span + agent_run span (has sessionKey)
  before_tool_call → creates tool_call span
  tool_result_persist → closes tool_call span
agent_end         → closes agent_run span, creates assistant_response span
```

Key context differences between hooks:
- Agent/tool hooks have `ctx.sessionKey`
- Message hooks have `ctx.channelId` / `ctx.conversationId` but NOT `sessionKey`
- Session hooks have `ctx.sessionId`
- `session_start` does not reliably fire in practice

### Concurrency Model

The `SessionOperationQueue` serializes all span operations per session key. This prevents:
- `agent_end` from racing ahead of `before_agent_start` (the agent can finish faster than span HTTP calls complete)
- Double-finishing spans when orphan cleanup and normal close both fire
- Close methods use synchronous capture-and-null of span IDs before any `await` as defense in depth

### Configuration

Zod-validated config from `api.pluginConfig` with env var fallbacks:
- `PREFACTOR_API_URL`, `PREFACTOR_API_TOKEN`, `PREFACTOR_AGENT_ID` (required for tracing)
- `logLevel`: debug | info | warn | error (default: info)
- `userInteractionTimeoutMinutes`: idle timeout (default: 5)
- `sessionTimeoutHours`: session lifetime (default: 24)

## Code Style

- ES modules with `.js` extensions on local imports
- 2 spaces, single quotes, trailing commas, semicolons
- `unknown` over `any` for flexible types
- Structured logging: `logger.info('event_name', { key: value })`
- Never throw from hooks - log and continue
- Hook handlers use snake_case matching OpenClaw convention

## Registered Hooks (14)

| Hook | Category | Action |
|------|----------|--------|
| `gateway_start` | Gateway | Logging |
| `gateway_stop` | Gateway | Emergency cleanup |
| `session_start` | Session | Logging |
| `session_end` | Session | Close all spans, finish agent instance |
| `before_agent_start` | Agent | Create user_message + agent_run spans |
| `agent_end` | Agent | Close agent_run, create assistant_response |
| `before_compaction` | Compaction | Logging |
| `after_compaction` | Compaction | Logging |
| `before_tool_call` | Tool | Create tool_call span |
| `after_tool_call` | Tool | Logging (hook is broken in OpenClaw) |
| `tool_result_persist` | Tool | Close tool_call span |
| `message_received` | Message | Buffer message for before_agent_start |
| `message_sending` | Message | Logging |
| `message_sent` | Message | Logging |

## Important Design Decisions

- **No SpanStack**: The span lifecycle is NOT LIFO (instant spans, concurrent tool calls), so a stack-based approach was deliberately rejected. Hierarchy is tracked via explicit flat fields in `SessionSpanState`.
- **Operation queue over in-flight dedup**: A serial queue per session replaces the previous `inFlightOperations` map. It prevents all classes of race conditions, not just duplicates.
- **Message buffering**: `message_received` buffers the message; `before_agent_start` consumes it. This solves the cross-context sessionKey problem without global state.
- **Agent is stateless for hierarchy**: `Agent` only tracks instance registration state (`instanceId`, `instanceRegistered`, `instanceStarted`). All span parent-child relationships are managed by `SessionStateManager`.
