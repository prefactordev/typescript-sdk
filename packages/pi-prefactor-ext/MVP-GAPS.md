# MVP Gaps: Missing Pieces Plan

**Document**: What we skipped in the MVP and how to add it  
**Status**: Planning for post-MVP iterations  
**Date**: 2026-04-09

---

## Overview

The MVP (1,381 lines, 11 hooks) provides basic instrumentation. Here's what's missing and how to add it.

---

## Gap 1: Turn Tracking Within Agent Run

### What's Missing

**Current MVP**: Turns are not tracked as separate spans. All turns are implicitly part of `pi:agent_run`.

**Why Skipped**: MVP focuses on core span hierarchy. Turn tracking adds complexity (need to track turn state, handle concurrent turns).

**Impact**: Can't see individual LLM response cycles in Prefactor UI.

### Implementation Plan

**File**: `src/session-state.ts`

**Add turn state tracking**:
```typescript
interface SessionSpanState {
  // ... existing fields
  currentTurnIndex: number;
  turnSpanIds: Map<number, string>;  // Track turns within agent_run
}
```

**Add turn span methods**:
```typescript
async createTurnSpan(
  sessionKey: string,
  turnIndex: number,
  payload: { turnIndex: number; messageCount?: number }
): Promise<string | null> {
  if (!this.agent) return null;
  const state = this.getOrCreateSessionState(sessionKey);
  
  const spanId = await this.agent.createSpan(
    sessionKey,
    'pi:turn',
    payload,
    state.agentRunSpanId  // Turn is child of agent_run
  );
  
  if (spanId) {
    state.turnSpanIds.set(turnIndex, spanId);
    state.currentTurnIndex = turnIndex;
  }
  
  return spanId;
}

async closeTurnSpan(
  sessionKey: string,
  turnIndex: number,
  status: 'complete' | 'failed' = 'complete'
): Promise<void> {
  const state = this.sessions.get(sessionKey);
  if (!state || !this.agent) return;
  
  const spanId = state.turnSpanIds.get(turnIndex);
  if (!spanId) return;
  
  await this.agent.finishSpan(sessionKey, spanId, status);
  state.turnSpanIds.delete(turnIndex);
}
```

**Update index.ts**:
```typescript
// In turn_start handler
pi.on("turn_start", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  await sessionManager.createTurnSpan(sessionKey, event.turnIndex, {
    turnIndex: event.turnIndex,
  });
});

// In turn_end handler (already exists, just use turn span as parent)
pi.on("turn_end", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  
  // Create assistant response as child of turn span
  const text = extractTextFromContent(event.message?.content);
  if (text) {
    await sessionManager.createAssistantResponseSpan(
      sessionKey,
      text,
      event.usage,
      { provider: ctx.model.provider, model: ctx.model.id }
    );
  }
  
  await sessionManager.closeTurnSpan(sessionKey, event.turnIndex);
});
```

**Effort**: ~2 hours  
**Priority**: Medium (nice to have for debugging multi-turn interactions)

---

## Gap 2: Thinking Block Capture

### What's Missing

**Current MVP**: Only captures assistant response text. Thinking/reasoning content is ignored.

**Why Skipped**: Requires extracting thinking from `event.message.thinking`, deciding whether to capture per-turn or per-agent-run.

**Impact**: Can't see agent reasoning process in Prefactor UI.

### Implementation Plan

**File**: `src/session-state.ts`

**Add thinking span method**:
```typescript
async createAgentThinkingSpan(
  sessionKey: string,
  thinking: string,
  tokens?: { input?: number; output?: number },
  metadata?: { provider?: string; model?: string; signature?: string }
): Promise<string | null> {
  if (!this.agent) return null;
  const state = this.getOrCreateSessionState(sessionKey);
  
  const spanId = await this.agent.createSpan(
    sessionKey,
    'pi:agent_thinking',
    {
      thinking: thinking.slice(0, config.maxInputLength),
      tokens,
      ...metadata,
    },
    state.agentRunSpanId  // Thinking is child of agent_run
  );
  
  if (spanId) {
    this.logger.info('thinking_span_created', { sessionKey, spanId });
  }
  
  return spanId;
}
```

**Update index.ts**:
```typescript
// In turn_end handler
pi.on("turn_end", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  
  // Capture thinking if enabled and present
  if (config.captureThinking && event.message?.thinking) {
    const thinking = typeof event.message.thinking === 'string'
      ? event.message.thinking
      : '';
    
    if (thinking) {
      await sessionManager.createAgentThinkingSpan(
        sessionKey,
        thinking,
        event.usage ? {
          input: event.usage.inputTokens,
          output: event.usage.outputTokens,
        } : undefined,
        {
          provider: ctx.model.provider,
          model: ctx.model.id,
        }
      );
    }
  }
  
  // ... rest of turn_end handler
});
```

**Add config option** (already exists in config.ts, just use it):
```typescript
// In config.ts (already there)
captureThinking: z.boolean().default(true)
```

**Effort**: ~1 hour  
**Priority**: High (valuable for understanding agent reasoning)

---

## Gap 3: Tool-Specific Schemas

### What's Missing

**Current MVP**: All tools use generic `pi:tool_call` schema with basic `toolName`, `toolCallId`, `input` fields.

**Why Skipped**: Requires defining schemas for each of pi's 4 built-in tools (read, write, edit, bash).

**Impact**: Prefactor can't validate tool-specific payloads or provide tool-specific UI.

### Implementation Plan

**File**: `src/tool-definitions.ts` (new file)

```typescript
/**
 * Pi built-in tool definitions
 * Maps tool names to canonical forms and input schemas
 */

export interface ToolDefinition {
  canonicalName: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export const PI_BUILTIN_TOOLS: Record<string, ToolDefinition> = {
  read: {
    canonicalName: 'read',
    description: 'Read file contents with optional offset and limit',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        offset: { type: 'number', description: 'Line number to start from (1-indexed)' },
        limit: { type: 'number', description: 'Maximum lines to read' },
      },
      required: ['path'],
    },
  },
  write: {
    canonicalName: 'write',
    description: 'Write content to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
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
        path: { type: 'string', description: 'File path to edit' },
        edits: {
          type: 'array',
          description: 'Array of edit blocks',
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
        command: { type: 'string', description: 'Command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds' },
      },
      required: ['command'],
    },
  },
};

export function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase();
}

export function getToolDefinition(toolName: string): ToolDefinition | undefined {
  const canonical = normalizeToolName(toolName);
  return PI_BUILTIN_TOOLS[canonical];
}
```

**Update src/agent.ts** (in agentSchemaVersion):
```typescript
// Add tool-specific schemas
this.agentSchemaVersion = {
  external_identifier: `plugin-${pluginVersion}`,
  span_type_schemas: [
    // ... existing schemas
    
    // Tool-specific schemas
    {
      name: 'pi:tool:read',
      description: 'Read file contents',
      template: '{{ path | default: "(unknown file)" }}{% if offset %}:{{ offset }}{% endif %}{% if limit %}-{{ offset | plus: input.limit }}{% endif %}',
      params_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          offset: { type: 'number', description: 'Start line' },
          limit: { type: 'number', description: 'Max lines' },
        },
      },
    },
    {
      name: 'pi:tool:write',
      description: 'Write file contents',
      template: '{{ path | default: "(unknown file)" }}',
      params_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'File content' },
        },
      },
    },
    {
      name: 'pi:tool:edit',
      description: 'Edit file with text replacement',
      template: '{{ path | default: "(unknown file)" }}',
      params_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          edits: { type: 'array', description: 'Edit blocks' },
        },
      },
    },
    {
      name: 'pi:tool:bash',
      description: 'Execute bash command',
      template: 'bash: `{% assign cmd = command | default: "(no command)" %}{% if cmd.size > 50 %}{{ cmd | slice: 0, 50 }}...{% else %}{{ cmd }}{% endif %}`',
      params_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
          timeout: { type: 'number', description: 'Timeout in ms' },
        },
      },
    },
  ],
};
```

**Update index.ts** (use specific span type):
```typescript
import { getToolDefinition, normalizeToolName } from './tool-definitions.js';

// In tool_execution_start handler
pi.on("tool_execution_start", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  const toolDef = getToolDefinition(event.toolName);
  const spanType = toolDef ? `pi:tool:${toolDef.canonicalName}` : 'pi:tool_call';
  
  const payload: Record<string, unknown> = {
    toolName: event.toolName,
    toolCallId: event.toolCallId,
  };
  
  if (config.captureToolInputs) {
    payload.input = event.args;
  }
  
  await sessionManager.createToolCallSpan(sessionKey, spanType, payload);
});
```

**Effort**: ~2-3 hours  
**Priority**: Medium (better schema validation, but generic works for now)

---

## Gap 4: before_provider_request Capture

### What's Missing

**Current MVP**: Doesn't capture LLM request payloads (messages, system prompt, model params).

**Why Skipped**: Payloads can be large, need truncation logic. Optional debugging feature.

**Impact**: Can't see exact LLM requests in Prefactor UI.

### Implementation Plan

**Add hook in index.ts**:
```typescript
pi.on("before_provider_request", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  
  logger.info('before_provider_request', {
    sessionKey,
    provider: event.provider,
    model: event.model,
    messageCount: Array.isArray(event.payload.messages)
      ? event.payload.messages.length
      : 0,
    hasSystemPrompt: !!(event.payload as any).system,
  });
  
  // Optional: Capture full payload (truncated)
  if (config.captureProviderPayloads) {
    const payload = {
      provider: event.provider,
      model: event.model,
      messages: Array.isArray(event.payload.messages)
        ? event.payload.messages.slice(-5) // Last 5 messages only
        : [],
      systemPrompt: (event.payload as any).system?.slice(0, 1000),
    };
    
    // Could create a span or log it
    logger.debug('provider_payload', payload);
  }
});
```

**Add config option**:
```typescript
// In config.ts
captureProviderPayloads: z.boolean().default(false)
```

**Effort**: ~30 minutes  
**Priority**: Low (debugging feature, not essential for tracing)

---

## Gap 5: Data Risk Configs

### What's Missing

**Current MVP**: No GDPR-style risk classifications for span types.

**Why Skipped**: OpenClaw-specific feature. Pi may not need it initially.

**Impact**: Prefactor can't apply risk-based policies to spans.

### Implementation Plan

**File**: `src/data-risk-config.ts` (new file, ~400 lines)

Copy from `openclaw-prefactor-plugin/src/data-risk-config.ts` and update:
- Change span type keys (`openclaw:*` → `pi:*`)
- Add pi-specific span types
- Adjust risk configs for pi's tool set

**Effort**: ~1-2 hours  
**Priority**: Low (enterprise feature, not needed for MVP)

---

## Gap 6: Additional Hooks

### Missing Hooks (9 of 20 total)

| Hook | Priority | Effort | Purpose |
|------|----------|--------|---------|
| `turn_start` | Medium | 15 min | Track turn boundaries |
| `context` | Low | 15 min | Log message modifications |
| `model_select` | Low | 15 min | Track model switches |
| `resources_discover` | Low | 15 min | Log resource loading |
| `session_before_switch` | Low | 15 min | Track session switches |
| `session_before_compact` | Low | 15 min | Track compaction |
| `session_compact` | Low | 15 min | Track compaction results |
| `tool_execution_update` | Low | 15 min | Log streaming updates |
| `tool_execution_end` | Low | 15 min | Fallback for tool_result |

**Total effort**: ~2 hours for all 9 hooks

### Implementation Example

```typescript
// In index.ts

pi.on("turn_start", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  logger.info('turn_start', { sessionKey, turnIndex: event.turnIndex });
  // Optional: await sessionManager.createTurnSpan(...)
});

pi.on("model_select", async (event, ctx) => {
  logger.info('model_select', {
    previousModel: event.previousModel?.id,
    newModel: event.model.id,
    source: event.source,
  });
});

pi.on("tool_execution_end", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  logger.debug('tool_execution_end', {
    sessionKey,
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    isError: event.isError,
  });
  // Fallback: close span if tool_result didn't fire
});
```

---

## Gap 7: Unit Tests

### What's Missing

**Current MVP**: No automated tests.

**Why Skipped**: Manual testing with test harness is sufficient for MVP.

**Impact**: Harder to catch regressions, changes require manual validation.

### Implementation Plan

**Directory**: `tests/`

**Test files**:
- `tests/config.test.ts` - Configuration loading and validation
- `tests/session-state.test.ts` - Span hierarchy management
- `tests/tool-definitions.test.ts` - Tool schema validation
- `tests/logger.test.ts` - Logging output

**Example** (`tests/config.test.ts`):
```typescript
import { describe, test, expect } from 'bun:test';
import { loadConfig, validateConfig } from '../src/config.js';

describe('loadConfig', () => {
  test('uses env vars when package config empty', () => {
    process.env.PREFACTOR_API_TOKEN = 'test-token';
    process.env.PREFACTOR_AGENT_ID = 'test-agent';
    
    const config = loadConfig({});
    expect(config.apiToken).toBe('test-token');
    expect(config.agentId).toBe('test-agent');
  });
  
  test('package config overrides env vars', () => {
    process.env.PREFACTOR_API_TOKEN = 'env-token';
    const config = loadConfig({ apiToken: 'pkg-token', agentId: 'test-agent' });
    expect(config.apiToken).toBe('pkg-token');
  });
  
  test('uses defaults for optional fields', () => {
    const config = loadConfig({ apiToken: 'test', agentId: 'test' });
    expect(config.apiUrl).toBe('https://app.prefactorai.com');
    expect(config.agentName).toBe('Pi Agent');
    expect(config.logLevel).toBe('info');
  });
});

describe('validateConfig', () => {
  test('passes with required fields', () => {
    const config = loadConfig({ apiToken: 'test', agentId: 'test' });
    const validation = validateConfig(config);
    expect(validation.ok).toBe(true);
  });
  
  test('fails without apiToken', () => {
    const config = loadConfig({ agentId: 'test' });
    const validation = validateConfig(config);
    expect(validation.ok).toBe(false);
    expect(validation.missing).toContain('PREFACTOR_API_TOKEN');
  });
});
```

**Effort**: ~3-4 hours  
**Priority**: Medium (important for CI/CD, but can wait until after MVP validation)

---

## Gap 8: Integration Tests

### What's Missing

**Current MVP**: Manual testing only (run pi with extension).

**Why Skipped**: Requires Prefactor API credentials, hard to automate.

**Impact**: End-to-end flow not automatically validated.

### Implementation Plan

**File**: `tests/integration.test.ts`

```typescript
import { describe, test, expect } from 'bun:test';

describe('Integration with Prefactor API', () => {
  test('creates session span', async () => {
    // Skip if no credentials
    if (!process.env.PREFACTOR_API_TOKEN) {
      console.log('Skipping: no credentials');
      return;
    }
    
    const config = loadConfig({});
    const logger = createLogger('debug');
    const agent = createAgent(config, logger);
    const sessionManager = createSessionStateManager(agent, logger, {});
    
    const sessionKey = 'test-session';
    const spanId = await sessionManager.createSessionSpan(sessionKey);
    
    expect(spanId).toBeTruthy();
    
    await sessionManager.closeSessionSpan(sessionKey);
  });
  
  test('creates tool call span', async () => {
    // Similar structure for tool spans
  });
});
```

**Effort**: ~2 hours  
**Priority**: Low (run manually when needed)

---

## Gap 9: Documentation Updates

### What's Missing

**Current MVP**: README.md needs update with:
- Setup instructions
- Configuration examples
- Troubleshooting guide
- Span hierarchy diagram

### Implementation Plan

**Update README.md**:
```markdown
# @prefactor/pi-prefactor-ext

Prefactor instrumentation for pi coding agent.

## Quick Start

1. Set environment variables:
   ```bash
   export PREFACTOR_API_TOKEN=your-token
   export PREFACTOR_AGENT_ID=your-agent-id
   ```

2. Install extension:
   ```bash
   cp -r packages/pi-prefactor-ext ~/.pi/agent/extensions/pi-prefactor
   ```

3. Reload pi:
   ```
   /reload
   ```

4. Verify:
   ```
   /prefactor-config
   ```

## Configuration

[... full config docs ...]

## Span Hierarchy

[... diagram ...]

## Troubleshooting

[... common issues ...]
```

**Effort**: ~1-2 hours  
**Priority**: High (users need clear setup instructions)

---

## Priority Summary

| Priority | Gaps | Total Effort |
|----------|------|--------------|
| **High** | Thinking capture, Documentation | 2-3 hours |
| **Medium** | Turn tracking, Tool schemas, Unit tests | 7-9 hours |
| **Low** | Provider payloads, Risk configs, Additional hooks, Integration tests | 5-6 hours |

**Total remaining work**: ~14-18 hours

---

## Recommended Order

1. **Thinking capture** (1 hour) - High value, low effort
2. **Documentation** (1-2 hours) - Unblock users
3. **Turn tracking** (2 hours) - Better visibility
4. **Tool schemas** (2-3 hours) - Better validation
5. **Additional hooks** (2 hours) - Complete coverage
6. **Unit tests** (3-4 hours) - CI/CD readiness
7. **Provider payloads** (30 min) - Debugging feature
8. **Risk configs** (1-2 hours) - Enterprise feature
9. **Integration tests** (2 hours) - Manual validation

---

## Next Actions

Pick based on priority:

**Immediate** (today):
- [ ] Thinking capture
- [ ] Documentation updates

**This week**:
- [ ] Turn tracking
- [ ] Tool schemas
- [ ] Additional hooks

**Next week**:
- [ ] Unit tests
- [ ] Integration tests
- [ ] Risk configs (if needed)

---

## Questions?

Each gap has detailed implementation plan above. Pick one and implement, or ask for help with specific gaps.
