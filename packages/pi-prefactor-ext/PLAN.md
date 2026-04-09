# Pi Prefactor Extension - Implementation Plan

## Overview

This document outlines the plan to build a Prefactor instrumentation plugin for the pi coding agent, following the architecture established by `@prefactor/openclaw-prefactor-plugin`.

## Repository Context

- **Monorepo**: Bun workspaces under `packages/*`
- **Existing packages**: `core`, `langchain`, `ai`, `openclaw-prefactor-plugin`
- **New package**: `pi-prefactor-ext` (pi extension, not OpenClaw plugin)
- **Philosophy**: Core-first, minimal required behavior, no speculative abstractions

---

## 1. OpenClaw Plugin Architecture Review

### Plugin Registration Model

OpenClaw uses a `register(api: OpenClawPluginApi)` function where the API provides event hooks:

```typescript
api.on('event_name', (event, ctx) => {
  // Handle event
});
```

### 24 Event Hooks (Full Lifecycle Coverage)

| Category | Hooks |
|----------|-------|
| **Gateway** | `gateway_start`, `gateway_stop` |
| **Session** | `session_start`, `session_end` |
| **Agent** | `before_agent_start`, `agent_end`, `llm_input`, `llm_output` |
| **Tools** | `before_tool_call`, `after_tool_call`, `tool_result_persist` |
| **Messages** | `message_received`, `message_sending`, `message_sent`, `before_message_write` |
| **Compaction** | `before_compaction`, `after_compaction`, `before_reset` |
| **Subagents** | `subagent_spawning`, `subagent_delivery_target`, `subagent_spawned`, `subagent_ended` |

### Span Hierarchy

```
session (24hr root span)
  └─ user_interaction (5min idle timeout)
      ├─ user_message (instant, auto-closed)
      ├─ agent_run (child of interaction)
      │   ├─ tool_call (concurrent, children of agent_run)
      │   └─ tool_call
      └─ assistant_response (instant, auto-closed)
```

### Key Components

1. **SessionStateManager**: Manages span hierarchy per session with timeouts, operation queuing for serialization, and cleanup
2. **Agent HTTP Client**: Handles AgentInstance registration, span CRUD, retry queue for failed operations
3. **Tool Definitions**: Maps OpenClaw tool names to canonical forms with schemas
4. **Data Risk Config**: GDPR-style risk classifications per span type

---

## 2. Pi Coding Agent Hook Points

### Extension API

Pi uses `ExtensionAPI` with similar event hook pattern:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("event_name", async (event, ctx) => {
    // Handle event
  });
}
```

### Available Event Hooks

#### Session Lifecycle
| Hook | Description |
|------|-------------|
| `session_start` | Session created/loaded (reason: startup/new/resume/fork/reload) |
| `session_shutdown` | Session ending |
| `session_before_switch` | Before switching sessions (can cancel) |
| `session_before_fork` | Before forking (can cancel) |
| `session_before_compact` / `session_compact` | Compaction lifecycle |
| `session_before_tree` / `session_tree` | Tree navigation |

#### Agent Lifecycle
| Hook | Description |
|------|-------------|
| `before_agent_start` | Before agent processes a prompt (can inject messages) |
| `agent_start` / `agent_end` | Agent execution boundaries |
| `turn_start` / `turn_end` | Per-turn boundaries (LLM response + tool calls) |
| `context` | Can modify messages before LLM call |

#### Tool Lifecycle
| Hook | Description |
|------|-------------|
| `tool_call` | Before tool execution (**can block**, input is mutable) |
| `tool_result` | After tool execution (can modify result) |
| `tool_execution_start` / `tool_execution_update` / `tool_execution_end` | Streaming tool events |

#### Message Lifecycle
| Hook | Description |
|------|-------------|
| `message_start` / `message_update` / `message_end` | Message streaming |
| `input` | Raw user input (before skill/template expansion) |

#### Model/Provider
| Hook | Description |
|------|-------------|
| `before_provider_request` | Can inspect/replace provider payload |
| `model_select` | Model selection/cycling |

#### Resources
| Hook | Description |
|------|-------------|
| `resources_discover` | Extensions can contribute skills, prompts, themes |

---

## 3. Proposed Span Hierarchy for Pi

```
session (root, 24hr lifetime)
  └─ user_interaction (5min idle timeout, per user message)
      ├─ user_message (instant, auto-closed)
      ├─ agent_run (child of interaction, spans full agent processing)
      │   ├─ turn_1 (LLM response cycle)
      │   │   ├─ llm_call (provider request/response)
      │   │   ├─ tool_call (concurrent siblings)
      │   │   └─ tool_call
      │   ├─ turn_2 (if agent continues)
      │   └─ turn_n
      └─ assistant_response (final response, auto-closed)
```

**Key difference from OpenClaw**: Pi has explicit turn-based execution (LLM → tools → LLM → tools...), so we track turns within the agent_run span.

---

## 4. Event Hook Mapping (OpenClaw → Pi)

| OpenClaw Hook | Pi Hook | Notes |
|--------------|---------|-------|
| `gateway_start` | _none_ | Pi doesn't have gateway concept |
| `gateway_stop` | _none_ | - |
| `session_start` | `session_start` | Same semantics |
| `session_end` | `session_shutdown` | Same semantics |
| `message_received` | `input` | Pi fires `input` for raw user text |
| `before_agent_start` | `before_agent_start` | Same semantics |
| `agent_end` | `agent_end` | Same semantics |
| `llm_input` | `before_provider_request` | Closest equivalent |
| `llm_output` | `turn_end` | Capture from event.message |
| `before_tool_call` | `tool_call` | Same, can block |
| `after_tool_call` | `tool_result` | Same, can modify |
| `tool_result_persist` | `tool_execution_end` | Final tool state |
| `message_sending` | `message_start` | Assistant response start |
| `message_sent` | `message_end` | Assistant response end |
| `subagent_*` | _none_ | Pi doesn't have subagents |

---

## 5. Package Structure

```
packages/pi-prefactor-ext/
├── src/
│   ├── index.ts              # Plugin entry, register all hooks
│   ├── agent.ts              # HTTP client (adapted from openclaw plugin)
│   ├── session-state.ts      # Span hierarchy management
│   ├── logger.ts             # Structured logging
│   ├── tool-definitions.ts   # Pi tool mappings (read, write, edit, bash)
│   ├── tool-span-contract.ts # Tool span schemas
│   └── data-risk-config.ts   # Risk configs per span type
├── tests/
│   └── index.test.ts
├── package.json
├── tsconfig.json
├── AGENTS.md
└── README.md
```

**Note**: We're using `.ts` extension files (not compiled plugin format) since pi extensions are loaded via jiti and support TypeScript directly.

---

## 6. Implementation Phases

### Phase 1: Core Plugin Structure

1. Create package directory and configuration files
2. Copy and adapt from `openclaw-prefactor-plugin`:
   - `agent.ts` - HTTP client (rename openclaw refs to pi)
   - `logger.ts` - Reuse as-is
   - `session-state.ts` - Adapt span hierarchy for pi's turn-based model
   - `tool-definitions.ts` - Map pi's built-in tools
   - `tool-span-contract.ts` - Reuse schema builders
   - `data-risk-config.ts` - Adapt risk configs

3. Create `index.ts` with hook registrations

### Phase 2: Span Lifecycle Management

1. Adapt `SessionStateManager` for pi's turn-based model:
   - Track turns within agent_run
   - Handle concurrent tool calls per turn
   - Capture LLM inputs/outputs from `before_provider_request` and `turn_end`

2. Implement idle timeout for user_interaction spans

3. Add cleanup for abandoned spans on `session_shutdown`

### Phase 3: Tool Instrumentation

1. Define supported pi tools:
   - `read`, `write`, `edit`, `bash` (built-in)
   - Custom tools from extensions

2. Create span schemas per tool type with:
   - Input schemas (TypeBox → JSON Schema)
   - Output schemas
   - Templates for display
   - Data risk configs

### Phase 4: Testing

1. Test with pi interactive mode
2. Verify span hierarchy in Prefactor UI
3. Test retry queue behavior
4. Test concurrent tool calls

---

## 7. Hook Implementation Examples

### User Input → User Message Span

```typescript
pi.on("input", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? "ephemeral";
  pendingUserMessage = { text: event.text, timestamp: Date.now() };
  
  await sessionManager.createOrGetInteractionSpan(sessionKey);
  await sessionManager.createUserMessageSpan(sessionKey, {
    text: event.text,
    timestamp: Date.now(),
  });
});
```

### Agent Run Start

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? "ephemeral";
  await sessionManager.createAgentRunSpan(sessionKey, {
    messageCount: event.messages?.length || 0,
  });
});
```

### Tool Call

```typescript
pi.on("tool_call", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? "ephemeral";
  await sessionManager.createToolCallSpan(sessionKey, event.toolName, {
    input: event.input,
    toolCallId: event.toolCallId,
  });
});
```

### Tool Result

```typescript
pi.on("tool_result", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? "ephemeral";
  await sessionManager.closeToolCallSpanWithResult(
    sessionKey,
    event.toolCallId,
    event.toolName,
    extractTextFromContent(event.result?.content),
    event.result?.isError ?? false
  );
});
```

### Turn End (LLM Output)

```typescript
pi.on("turn_end", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? "ephemeral";
  
  // Extract thinking blocks if present
  if (event.message?.thinking) {
    await sessionManager.createAgentThinkingSpan(
      sessionKey,
      event.message.thinking,
      event.usage,
      { provider: ctx.model?.provider, model: ctx.model?.id }
    );
  }
  
  // Create assistant response span
  const text = extractTextFromContent(event.message?.content);
  await sessionManager.createAssistantResponseSpan(
    sessionKey,
    text,
    event.usage,
    { provider: ctx.model?.provider, model: ctx.model?.id }
  );
});
```

### Session Lifecycle

```typescript
pi.on("session_start", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? "ephemeral";
  await sessionManager.createSessionSpan(sessionKey);
});

pi.on("session_shutdown", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? "ephemeral";
  await sessionManager.closeSessionSpan(sessionKey);
});
```

---

## 8. Plugin Configuration Schema

```json
{
  "type": "object",
  "properties": {
    "apiUrl": {
      "type": "string",
      "description": "Prefactor API URL"
    },
    "apiToken": {
      "type": "string",
      "description": "Prefactor API token"
    },
    "agentId": {
      "type": "string",
      "description": "Agent ID registered in Prefactor"
    },
    "agentName": {
      "type": "string",
      "default": "Pi Agent"
    },
    "agentVersion": {
      "type": "string",
      "default": "default"
    },
    "logLevel": {
      "type": "string",
      "enum": ["debug", "info", "warn", "error"],
      "default": "info"
    },
    "userInteractionTimeoutMinutes": {
      "type": "number",
      "default": 5,
      "minimum": 1,
      "maximum": 60
    },
    "sessionTimeoutHours": {
      "type": "number",
      "default": 24,
      "minimum": 1,
      "maximum": 168
    },
    "captureThinking": {
      "type": "boolean",
      "default": true
    },
    "captureToolInputs": {
      "type": "boolean",
      "default": true
    },
    "captureToolOutputs": {
      "type": "boolean",
      "default": true
    }
  },
  "required": []
}
```

---

## 9. Key Differences from OpenClaw Plugin

| Aspect | OpenClaw | Pi |
|--------|----------|-----|
| **Plugin API** | `OpenClawPluginApi` | `ExtensionAPI` |
| **Event model** | 24 specific hooks | ~20 hooks (different names) |
| **Agent model** | Single agent_run | Multiple turns per agent_run |
| **LLM events** | `llm_input`, `llm_output` | `before_provider_request`, `turn_end` |
| **Tool calls** | Sequential with persist | Concurrent execution |
| **Subagents** | Supported | Not supported |
| **Message queue** | Steering/follow-up | Same model |
| **Loading** | Compiled plugin (`.plugin.json`) | TypeScript extension (jiti) |

---

## 10. Span Type Naming Convention

Following the openclaw plugin pattern, pi spans will use `pi:*` prefix:

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

---

## 11. Tool Definitions for Pi

Pi's built-in tools:

| Tool | Input Schema | Output |
|------|-------------|--------|
| `read` | `{ path: string, offset?: number, limit?: number }` | File contents |
| `write` | `{ path: string, content: string }` | Write confirmation |
| `edit` | `{ path: string, edits: Array<{ oldText: string, newText: string }> }` | Edit result |
| `bash` | `{ command: string, timeout?: number }` | stdout/stderr/exitCode |

Custom tools from extensions will use generic `pi:tool` span type.

---

## 12. Dependencies

```json
{
  "name": "@prefactor/pi-prefactor-ext",
  "version": "0.0.1",
  "type": "module",
  "dependencies": {
    "@prefactor/core": "workspace:*",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "^0.66.0",
    "@sinclair/typebox": "^0.34.0",
    "typescript": "^5.0.0"
  }
}
```

**Note**: We depend on `@prefactor/core` for HTTP client and span types. The pi coding agent is a dev dependency for types only (loaded at runtime by pi).

---

## 13. Testing Strategy

### Unit Tests
- SessionStateManager operation queuing
- Tool span schema generation
- Risk config lookups

### Integration Tests
- Hook registration verification
- Span creation/finishing flow
- Retry queue behavior

### Manual Testing
1. Install extension in `~/.pi/agent/extensions/`
2. Run pi with Prefactor API configured
3. Verify spans appear in Prefactor UI
4. Test concurrent tool calls
5. Test session cleanup on exit

---

## 14. Future Considerations (Not Implemented Yet)

- **Custom UI**: Show Prefactor span status in pi footer
- **Commands**: `/prefactor-status` to show current session span state
- **Compaction hooks**: Track compaction as special spans
- **Tree navigation**: Capture branch events
- **Model cycling**: Track model switches as metadata

---

## 15. References

- OpenClaw plugin: `packages/openclaw-prefactor-plugin/`
- Pi extensions docs: `~/.pi/agent/docs/extensions.md`
- Pi SDK docs: `~/.pi/agent/docs/sdk.md`
- Pi examples: `~/.pi/agent/examples/extensions/`

---

## 16. Next Steps

1. [ ] Create package structure and config files
2. [ ] Copy/adapt core files from openclaw plugin
3. [ ] Implement hook registrations in index.ts
4. [ ] Test with local pi instance
5. [ ] Iterate on span hierarchy based on real usage
