# Implementation Gap Analysis: OpenClaw → Pi

**Goal**: Instrument pi agent with Prefactor spans, matching OpenClaw plugin functionality.

---

## What OpenClaw Plugin Does (Reference Implementation)

### 1. Event Hook Registration (24 hooks)

```typescript
// OpenClaw plugin structure
api.on('session_start', handler);
api.on('session_end', handler);
api.on('message_received', handler);
api.on('before_agent_start', handler);
api.on('agent_end', handler);
api.on('llm_input', handler);
api.on('llm_output', handler);
api.on('before_tool_call', handler);
api.on('after_tool_call', handler);
api.on('tool_result_persist', handler);
// ... 14 more hooks
```

### 2. Span Hierarchy Created

```
session (24hr root)
  └─ user_interaction (5min idle timeout)
      ├─ user_message
      ├─ agent_run
      │   ├─ tool_call (concurrent)
      │   └─ tool_call
      └─ assistant_response
```

### 3. Components Used

| Component | Purpose | Lines |
|-----------|---------|-------|
| `agent.ts` | HTTP client for Prefactor API (span CRUD, instance lifecycle) | ~900 |
| `session-state.ts` | Manages span hierarchy, timeouts, operation queue | ~700 |
| `logger.ts` | Structured logging | ~100 |
| `tool-definitions.ts` | Maps OpenClaw tool names to schemas | ~300 |
| `tool-span-contract.ts` | Tool span JSON schema builders | ~200 |
| `data-risk-config.ts` | GDPR-style risk configs per span type | ~400 |
| `index.ts` | Hook registrations + span operations | ~800 |

**Total**: ~3,400 lines of instrumentation code

---

## What Pi Needs (Gap Analysis)

### ✅ Already Complete

| Component | Status | Notes |
|-----------|--------|-------|
| Test harness | ✅ Done | Validates all 20 hooks fire correctly |
| Configuration | ✅ Done | Hybrid env vars + package config |
| Hook mapping | ✅ Done | Documented in HOOK-MAPPING.md |
| Plan | ✅ Done | PLAN-v2.md with updated approach |

### ⏳ Need to Implement

| Component | Priority | Effort | Notes |
|-----------|----------|--------|-------|
| `src/logger.ts` | High | Low | Copy from OpenClaw, minimal changes |
| `src/agent.ts` | High | Medium | Adapt from OpenClaw (rename openclaw→pi) |
| `src/session-state.ts` | High | Medium | Adapt span hierarchy for pi's turn model |
| `src/tool-definitions.ts` | High | Medium | Map pi's 4 built-in tools + custom tools |
| `src/tool-span-contract.ts` | High | Low | Reuse from OpenClaw (generic) |
| `src/data-risk-config.ts` | Medium | Medium | Adapt risk configs for pi span types |
| `src/index.ts` | High | High | Main extension with all hook handlers |
| `src/config.ts` | ✅ Done | - | Already implemented |

**Total remaining**: ~2,500-3,000 lines across 7 files

---

## Key Differences: OpenClaw vs Pi

### 1. Event Hook Names

| OpenClaw | Pi | Adaptation Needed |
|----------|-----|-------------------|
| `session_start` | `session_start` | ✅ Same |
| `session_end` | `session_shutdown` | ⚠️ Rename |
| `message_received` | `input` | ⚠️ Different semantics |
| `before_agent_start` | `before_agent_start` | ✅ Same |
| `agent_end` | `agent_end` | ✅ Same |
| `llm_input` | `before_provider_request` | ⚠️ Different payload |
| `llm_output` | `turn_end` | ⚠️ Extract from event.message |
| `before_tool_call` | `tool_execution_start` | ⚠️ Different event structure |
| `after_tool_call` | `tool_result` | ⚠️ Can modify result |
| `tool_result_persist` | `tool_execution_end` | ⚠️ Fallback only |

### 2. Agent Model

| Aspect | OpenClaw | Pi | Impact |
|--------|----------|-----|--------|
| Agent execution | Single `agent_run` | Multiple `turns` per agent_run | Track turns within agent_run |
| Tool calls | Sequential | Concurrent (preflight → parallel) | Track by toolCallId, handle concurrency |
| LLM events | `llm_input`, `llm_output` | `before_provider_request`, `turn_end` | Capture at different points |
| Thinking blocks | In `llm_output` | In `event.message.thinking` | Extract from different location |

### 3. Span Hierarchy

**OpenClaw**:
```
session
  └─ user_interaction
      ├─ user_message
      ├─ agent_run
      │   ├─ tool_call
      │   └─ tool_call
      └─ assistant_response
```

**Pi** (adapted):
```
session
  └─ user_interaction
      ├─ user_message
      ├─ agent_run
      │   ├─ turn_1
      │   │   ├─ tool_call (concurrent)
      │   │   └─ tool_call
      │   ├─ turn_2 (if agent continues)
      │   └─ assistant_response (final)
      └─ assistant_response (per-turn, optional)
```

**Key change**: Pi has explicit turn boundaries, so we track turns within agent_run.

### 4. Tool Execution Flow

**OpenClaw**:
```
before_tool_call → after_tool_call → tool_result_persist
```

**Pi**:
```
tool_execution_start → tool_call → tool_execution_update (×n) 
→ tool_result → tool_execution_end
```

**Action**: Capture span at `tool_execution_start`, close at `tool_result`.

---

## Implementation Plan

### Phase 1: Core Infrastructure (2-3 hours)

#### 1.1 Create `src/logger.ts`
```typescript
// Copy from openclaw-prefactor-plugin/src/logger.ts
// Change: Rename namespace from 'openclaw-prefactor' to 'pi-prefactor'
// Effort: ~15 minutes
```

#### 1.2 Create `src/agent.ts`
```typescript
// Copy from openclaw-prefactor-plugin/src/agent.ts
// Changes needed:
// - Rename 'openclaw' → 'pi' in span type names
// - Update version identifiers (pi version instead of openclaw version)
// - Update span type schemas in agentSchemaVersion
// - Remove openclaw-specific tool schemas, add pi tool schemas
// Effort: ~1-2 hours
```

Key changes in `agent.ts`:
```typescript
// OpenClaw
this.agentVersion = {
  external_identifier: `openclaw-${openclawVersion}-plugin-${pluginVersion}-${userVersion}`,
  name: agentName,
  description: `${agentName} — OpenClaw ${openclawVersion}...`,
};

// Pi
this.agentVersion = {
  external_identifier: `pi-${piVersion}-plugin-${pluginVersion}-${userVersion}`,
  name: agentName,
  description: `${agentName} — Pi ${piVersion}...`,
};

// Span type schemas
this.agentSchemaVersion = {
  external_identifier: `plugin-${pluginVersion}`,
  span_type_schemas: [
    { name: 'pi:user_message', ... },
    { name: 'pi:tool_call', ... },
    { name: 'pi:tool:read', ... },  // Pi-specific tool schemas
    { name: 'pi:tool:write', ... },
    { name: 'pi:tool:edit', ... },
    { name: 'pi:tool:bash', ... },
    { name: 'pi:agent_run', ... },
    { name: 'pi:session', ... },
    { name: 'pi:user_interaction', ... },
    { name: 'pi:agent_thinking', ... },
    { name: 'pi:assistant_response', ... },
  ],
};
```

#### 1.3 Create `src/session-state.ts`
```typescript
// Copy from openclaw-prefactor-plugin/src/session-state.ts
// Changes needed:
// - Add turn tracking within agent_run
// - Update span type names (openclaw:* → pi:*)
// - Handle pi's concurrent tool execution model
// - Capture thinking blocks from turn_end event
// Effort: ~2-3 hours
```

Key additions:
```typescript
interface SessionSpanState {
  // ... existing fields
  currentTurnIndex: number;
  turnSpanIds: Map<number, string>;  // Track turns within agent_run
}

// New method for turn tracking
async createTurnSpan(
  sessionKey: string,
  turnIndex: number,
  payload: Record<string, unknown>
): Promise<string | null> {
  const state = this.getOrCreateSessionState(sessionKey);
  const parentSpanId = state.agentRunSpanId;  // Turns are children of agent_run
  
  const spanId = await this.agent.createSpan(
    sessionKey,
    'pi:turn',
    { turnIndex, ...payload },
    parentSpanId
  );
  
  if (spanId) {
    state.turnSpanIds.set(turnIndex, spanId);
    state.currentTurnIndex = turnIndex;
  }
  
  return spanId;
}
```

### Phase 2: Tool Definitions (1-2 hours)

#### 2.1 Create `src/tool-definitions.ts`
```typescript
// New file (no direct OpenClaw equivalent)
// Maps pi's built-in tools to canonical names and schemas

export const PI_BUILTIN_TOOLS = {
  read: {
    canonicalName: 'read',
    description: 'Read file contents',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['path'],
    },
  },
  write: {
    canonicalName: 'write',
    description: 'Write file contents',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  edit: {
    canonicalName: 'edit',
    description: 'Edit file with exact text replacement',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string' },
              newText: { type: 'string' },
            },
          },
        },
      },
      required: ['path', 'edits'],
    },
  },
  bash: {
    canonicalName: 'bash',
    description: 'Execute bash command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number' },
      },
      required: ['command'],
    },
  },
};

// Also handle custom tools from extensions
export function normalizeToolName(toolName: string): string {
  // Convert to lowercase, handle aliases
  return toolName.toLowerCase();
}
```

#### 2.2 Create `src/tool-span-contract.ts`
```typescript
// Copy from openclaw-prefactor-plugin/src/tool-span-contract.ts
// Changes: Minimal (generic schema builders)
// Update namespace references if any
// Effort: ~30 minutes
```

#### 2.3 Create `src/data-risk-config.ts`
```typescript
// Copy from openclaw-prefactor-plugin/src/data-risk-config.ts
// Changes:
// - Update span type keys (openclaw:* → pi:*)
// - Add pi-specific span types (pi:turn, pi:agent_thinking)
// - Adjust risk configs for pi's tool set
// Effort: ~1 hour
```

### Phase 3: Main Extension (3-4 hours)

#### 3.1 Create `src/index.ts`
```typescript
// Main extension entry point
// Similar structure to openclaw-prefactor-plugin/src/index.ts
// But with pi-specific hooks and event handling

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadConfig, validateConfig } from './config.js';
import { createLogger } from './logger.js';
import { createAgent } from './agent.js';
import { createSessionStateManager } from './session-state.js';

export default function prefactorExtension(pi: ExtensionAPI) {
  // Load configuration
  const packageConfig = pi.getPackageConfig?.('pi-prefactor') ?? {};
  const config = loadConfig(packageConfig);
  const validation = validateConfig(config);
  
  if (!validation.ok) {
    console.error('[pi-prefactor]', validation.error);
    registerConfigCommand(pi);
    return;
  }
  
  // Initialize
  const logger = createLogger(config.logLevel);
  const agent = createAgent(config, logger);
  const sessionManager = createSessionStateManager(agent, logger, config);
  
  // Register all hooks
  registerSessionHooks(pi, sessionManager, logger);
  registerAgentHooks(pi, sessionManager, logger, config);
  registerToolHooks(pi, sessionManager, logger, config);
  registerMessageHooks(pi, sessionManager, logger);
  registerProviderHooks(pi, logger);
  
  // Register help command
  registerConfigCommand(pi, config);
  
  logger.info('extension_initialized');
}
```

#### 3.2 Hook Handler Examples

**Session Hooks**:
```typescript
function registerSessionHooks(
  pi: ExtensionAPI,
  sessionManager: SessionStateManager,
  logger: Logger
) {
  pi.on("session_start", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    logger.info('session_start', { reason: event.reason, sessionKey });
    await sessionManager.createSessionSpan(sessionKey);
  });
  
  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    logger.info('session_shutdown', { sessionKey });
    await sessionManager.closeSessionSpan(sessionKey);
  });
}
```

**Agent Hooks**:
```typescript
function registerAgentHooks(
  pi: ExtensionAPI,
  sessionManager: SessionStateManager,
  logger: Logger,
  config: PrefactorConfig
) {
  let pendingUserMessage: { text: string; timestamp: number } | null = null;
  
  pi.on("input", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    pendingUserMessage = { text: event.text, timestamp: Date.now() };
    await sessionManager.createOrGetInteractionSpan(sessionKey);
    await sessionManager.createUserMessageSpan(sessionKey, {
      text: event.text,
      timestamp: Date.now(),
    });
  });
  
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    if (pendingUserMessage) {
      await sessionManager.createUserMessageSpan(sessionKey, pendingUserMessage);
      pendingUserMessage = null;
    }
    await sessionManager.createAgentRunSpan(sessionKey, {
      messageCount: event.messages?.length || 0,
    });
  });
  
  pi.on("turn_start", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    await sessionManager.createTurnSpan(sessionKey, event.turnIndex, {
      turnIndex: event.turnIndex,
    });
  });
  
  pi.on("turn_end", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    
    // Capture thinking if enabled and present
    if (config.captureThinking && event.message?.thinking) {
      await sessionManager.createAgentThinkingSpan(
        sessionKey,
        event.message.thinking,
        event.usage,
        { provider: ctx.model?.provider, model: ctx.model?.id }
      );
    }
    
    // Capture assistant response
    const text = extractTextFromContent(event.message?.content);
    await sessionManager.createAssistantResponseSpan(
      sessionKey,
      text,
      event.usage,
      { provider: ctx.model?.provider, model: ctx.model?.id }
    );
  });
  
  pi.on("agent_end", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    await sessionManager.closeAgentRunSpan(
      sessionKey,
      event.success ? 'complete' : 'failed'
    );
  });
}
```

**Tool Hooks**:
```typescript
function registerToolHooks(
  pi: ExtensionAPI,
  sessionManager: SessionStateManager,
  logger: Logger,
  config: PrefactorConfig
) {
  pi.on("tool_execution_start", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    
    const payload: Record<string, unknown> = {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
    };
    
    if (config.captureToolInputs) {
      payload.input = truncatePayload(event.args, config.maxInputLength);
    }
    
    await sessionManager.createToolCallSpan(sessionKey, event.toolName, payload);
  });
  
  pi.on("tool_result", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    
    const resultText = extractTextFromContent(event.content);
    const isError = event.isError ?? false;
    
    let resultPayload: Record<string, unknown> | undefined;
    if (config.captureToolOutputs) {
      resultPayload = {
        output: truncatePayload(resultText, config.maxOutputLength),
        isError,
      };
    }
    
    await sessionManager.closeToolCallSpanWithResult(
      sessionKey,
      event.toolCallId,
      event.toolName,
      resultText,
      isError
    );
  });
}
```

### Phase 4: Testing & Polish (2-3 hours)

#### 4.1 Unit Tests
```bash
# Test configuration
bun test packages/pi-prefactor-ext/tests/config.test.ts

# Test session state manager
bun test packages/pi-prefactor-ext/tests/session-state.test.ts

# Test tool definitions
bun test packages/pi-prefactor-ext/tests/tool-definitions.test.ts
```

#### 4.2 Integration Test
```bash
# Run with real Prefactor credentials
export PREFACTOR_API_TOKEN=real-token
export PREFACTOR_AGENT_ID=real-agent-id
pi -e ./packages/pi-prefactor-ext/src/index.ts

# Verify in Prefactor UI
# https://app.prefactorai.com
```

#### 4.3 Documentation
- Update README.md with setup instructions
- Add examples directory
- Create troubleshooting guide

---

## Effort Estimate

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| **Phase 1: Core Infrastructure** | logger.ts, agent.ts, session-state.ts | 3-5 hours |
| **Phase 2: Tool Definitions** | tool-definitions.ts, tool-span-contract.ts, data-risk-config.ts | 2-3 hours |
| **Phase 3: Main Extension** | index.ts with all hook handlers | 3-4 hours |
| **Phase 4: Testing & Polish** | Tests, integration, docs | 2-3 hours |
| **Total** | | **10-15 hours** |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Pi event data shapes differ from docs | Low | Medium | Test harness already validated shapes |
| Concurrent tool execution breaks span hierarchy | Medium | Medium | Track by toolCallId, test thoroughly |
| Prefactor API schema validation fails | Medium | High | Start with minimal spans, iterate |
| Turn tracking adds complexity | Low | Low | Optional feature, can skip initially |
| Performance overhead >5ms per hook | Low | Medium | Profile with test harness, optimize |

---

## Critical Path

To get basic instrumentation working (MVP):

1. ✅ **Configuration** - Already done
2. ⏳ **logger.ts** - 15 min copy
3. ⏳ **agent.ts** - 1-2 hours adaptation
4. ⏳ **session-state.ts** - 2-3 hours adaptation
5. ⏳ **index.ts** (minimal hooks only) - 2 hours
   - `session_start`, `session_shutdown`
   - `input`, `before_agent_start`, `agent_end`
   - `tool_execution_start`, `tool_result`
   - Skip turns and thinking initially

**MVP Time**: ~5-6 hours

**Full Implementation**: ~10-15 hours

---

## Recommendation

**Start with MVP** to validate the approach:

1. Copy/adapt `logger.ts`, `agent.ts`, `session-state.ts`
2. Implement minimal `index.ts` with core hooks (session, agent, tools)
3. Test with real Prefactor API
4. Iterate to add turns, thinking, and advanced features

This gets instrumentation working quickly, then we can enhance based on real usage feedback.

---

## Next Actions

1. [ ] Create `src/logger.ts` (copy from OpenClaw)
2. [ ] Create `src/agent.ts` (adapt from OpenClaw)
3. [ ] Create `src/session-state.ts` (adapt from OpenClaw)
4. [ ] Create `src/index.ts` (minimal hook handlers)
5. [ ] Test with Prefactor API credentials
6. [ ] Iterate based on results

Shall I proceed with creating these files?
