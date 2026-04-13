# P1-3 & P1-4: Turn Spans + Tool-Specific Schemas

**Priority**: HIGH (v0.0.2)  
**Effort**: ~5 hours total  
**Status**: Ready for implementation  

---

## Overview

Implement two complementary features:
1. **Turn Spans** - Track individual turns in multi-turn agent runs
2. **Tool-Specific Schemas** - Use specific schemas for bash, read, write, edit tools

---

## Part 1: Turn Spans (P1-3)

### Problem

Multi-turn agent runs (LLM → tools → LLM → tools) are not tracked individually. All turns lumped into single `pi:agent_run`.

**Example Scenario**:
```
User: "Refactor this function"
Turn 0: Agent calls read tool
Turn 1: Agent calls edit tool  
Turn 2: Agent responds with summary
```

**Current**: All 3 turns in single `pi:agent_run`  
**Expected**: Each turn as `pi:turn` child of agent_run

### Desired Hierarchy

```
pi:agent_run
  ├─ pi:turn (turnIndex: 0)
  │   └─ pi:tool:bash (or other tool)
  ├─ pi:turn (turnIndex: 1)
  │   └─ pi:tool:edit
  └─ pi:turn (turnIndex: 2)
      └─ pi:assistant_response
```

### Implementation Tasks

#### Task 1.1: Add Turn Schema to agent.ts

**File**: `src/agent.ts`  
**Location**: In `agentSchemaVersion.span_type_schemas` array

**Add this schema**:
```typescript
{
  name: 'pi:turn',
  description: 'Single turn in multi-turn agent execution',
  template: 'Turn {{ turnIndex | default: 0 }}',
  params_schema: {
    type: 'object',
    properties: {
      turnIndex: { 
        type: 'number', 
        description: 'Turn number (0-indexed)' 
      },
      model: { 
        type: 'string', 
        description: 'Model used for this turn' 
      },
    },
  },
}
```

---

#### Task 1.2: Add Turn Tracking to SessionSpanState

**File**: `src/session-state.ts`

**Add to interface**:
```typescript
interface SessionSpanState {
  // ... existing fields
  
  // Turn tracking
  currentTurnIndex: number;
  turnSpans: Map<number, string>;  // turnIndex -> spanId
}
```

**Add methods**:
```typescript
/**
 * Create a turn span as child of agent_run.
 */
async createTurnSpan(
  sessionKey: string,
  turnIndex: number,
  payload: {
    turnIndex: number;
    model?: string;
  }
): Promise<string | null> {
  if (!this.agent) return null;
  const state = this.states.get(sessionKey);
  if (!state) {
    this.logger.warn('cannot_create_turn_span_no_state', { sessionKey, turnIndex });
    return null;
  }
  
  if (!state.agentRunSpanId) {
    this.logger.warn('cannot_create_turn_span_no_agent_run', { sessionKey, turnIndex });
    return null;
  }
  
  const spanId = await this.agent.createSpan(
    sessionKey,
    'pi:turn',
    payload,
    state.agentRunSpanId  // Parent is agent_run
  );
  
  if (spanId) {
    state.currentTurnIndex = turnIndex;
    state.turnSpans.set(turnIndex, spanId);
    this.logger.debug('turn_span_created', { 
      sessionKey, 
      turnIndex, 
      spanId 
    });
  }
  
  return spanId;
}

/**
 * Close a turn span.
 */
async closeTurnSpan(
  sessionKey: string,
  turnIndex: number,
  resultPayload?: Record<string, unknown>
): Promise<void> {
  if (!this.agent) return;
  const state = this.states.get(sessionKey);
  if (!state) {
    this.logger.warn('cannot_close_turn_span_no_state', { sessionKey, turnIndex });
    return;
  }
  
  const spanId = state.turnSpans.get(turnIndex);
  if (!spanId) {
    this.logger.warn('turn_span_not_found', { sessionKey, turnIndex });
    return;
  }
  
  await this.agent.finishSpan(sessionKey, spanId, 'complete', resultPayload);
  this.logger.debug('turn_span_closed', { sessionKey, turnIndex });
}
```

---

#### Task 1.3: Add Hook Handlers in index.ts

**File**: `src/index.ts`

**Add after existing handlers**:
```typescript
// Turn tracking
pi.on("turn_start", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) {
    logger.debug('turn_start_no_session', { sessionId: ctx.sessionId });
    return;
  }
  
  logger.debug('turn_start', { 
    sessionKey, 
    turnIndex: event.turnIndex,
  });
  
  await sessionManager.createTurnSpan(sessionKey, event.turnIndex, {
    turnIndex: event.turnIndex,
    model: ctx.model?.id,
  });
});

pi.on("turn_end", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) {
    logger.debug('turn_end_no_session', { sessionId: ctx.sessionId });
    return;
  }
  
  logger.debug('turn_end', { 
    sessionKey, 
    turnIndex: event.turnIndex,
    success: event.success,
  });
  
  await sessionManager.closeTurnSpan(sessionKey, event.turnIndex, {
    turnIndex: event.turnIndex,
    success: event.success,
  });
});
```

---

#### Task 1.4: Update Hook Count

**File**: `src/index.ts`

**Update**:
```typescript
logger.info('extension_initialized', {
  hooks: 15,  // Was: 13 (added turn_start, turn_end)
  sessionTimeoutHours: config.sessionTimeoutHours,
  interactionTimeoutMinutes: config.userInteractionTimeoutMinutes,
});
```

---

## Part 2: Tool-Specific Schemas (P1-4)

### Problem

All tools use generic `pi:tool_call` schema. Prefactor can't validate tool-specific payloads or provide tool-specific UI.

### Solution

Add specific schemas for each builtin tool: `pi:tool:bash`, `pi:tool:read`, `pi:tool:write`, `pi:tool:edit`

---

#### Task 2.1: Add Tool Schemas to agent.ts

**File**: `src/agent.ts`  
**Location**: In `agentSchemaVersion.span_type_schemas` array

**Add these schemas**:

```typescript
// Bash tool
{
  name: 'pi:tool:bash',
  description: 'Bash command execution',
  template: '{{ command | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Bash command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds' },
      cwd: { type: 'string', description: 'Working directory' },
      // Result fields (on finish)
      exitCode: { type: 'number', description: 'Exit code' },
      stdout: { type: 'string', description: 'Standard output (truncated)' },
      stderr: { type: 'string', description: 'Standard error (truncated)' },
      durationMs: { type: 'number', description: 'Execution duration' },
    },
  },
}

// Read tool
{
  name: 'pi:tool:read',
  description: 'File read operation',
  template: '{{ path | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
      offset: { type: 'number', description: 'Start line number' },
      limit: { type: 'number', description: 'Maximum lines to read' },
      // Result fields
      contentLength: { type: 'number', description: 'Bytes read' },
      lineCount: { type: 'number', description: 'Lines read' },
      encoding: { type: 'string', description: 'File encoding' },
    },
  },
}

// Write tool
{
  name: 'pi:tool:write',
  description: 'File write operation',
  template: '{{ path | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write' },
      contentLength: { type: 'number', description: 'Bytes written' },
      created: { type: 'boolean', description: 'Whether file was created (vs updated)' },
      // Result fields
      backupPath: { type: 'string', description: 'Backup file path if created' },
      success: { type: 'boolean', description: 'Write success' },
    },
  },
}

// Edit tool
{
  name: 'pi:tool:edit',
  description: 'File edit operation',
  template: '{{ path | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to edit' },
      editCount: { type: 'number', description: 'Number of edit blocks' },
      // Result fields
      successCount: { type: 'number', description: 'Successful edits' },
      failedCount: { type: 'number', description: 'Failed edits' },
      oldTextHashes: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Hashes of replaced text',
      },
      newTextLengths: {
        type: 'array',
        items: { type: 'number' },
        description: 'Lengths of replacement text',
      },
    },
  },
}
```

---

#### Task 2.2: Update Tool Execution Handler

**File**: `src/index.ts`

**Update `tool_execution_start` handler**:
```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) {
    logger.debug('tool_execution_start_no_session', { sessionId: ctx.sessionId });
    return;
  }
  
  logger.debug('tool_execution_start', {
    sessionKey,
    toolName: event.toolName,
    toolCallId: event.toolCallId,
  });
  
  // Determine schema name based on tool name
  const schemaName = `pi:tool:${event.toolName}` as 
    | 'pi:tool:bash'
    | 'pi:tool:read'
    | 'pi:tool:write'
    | 'pi:tool:edit'
    | 'pi:tool_call';  // Fallback for unknown tools
  
  // Build tool-specific payload
  const payload: Record<string, unknown> = {
    toolCallId: event.toolCallId,
  };
  
  if (config.captureToolInputs) {
    if (event.toolName === 'bash') {
      const args = event.args as { command?: string; timeout?: number; cwd?: string };
      payload.command = args.command;
      payload.timeout = args.timeout;
      payload.cwd = args.cwd;
    } else if (event.toolName === 'read') {
      const args = event.args as { path?: string; offset?: number; limit?: number };
      payload.path = args.path;
      payload.offset = args.offset;
      payload.limit = args.limit;
    } else if (event.toolName === 'write') {
      const args = event.args as { path?: string; content?: string };
      payload.path = args.path;
      payload.contentLength = args.content?.length;
      payload.created = (event as any).created;  // If available
    } else if (event.toolName === 'edit') {
      const args = event.args as { path?: string; edits?: any[] };
      payload.path = args.path;
      payload.editCount = args.edits?.length;
    }
  }
  
  await sessionManager.createToolCallSpan(sessionKey, event.toolName, payload, schemaName);
});
```

---

#### Task 2.3: Update Tool Result Handler

**File**: `src/index.ts`

**Update `tool_result` handler**:
```typescript
pi.on("tool_result", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) {
    logger.debug('tool_result_no_session', { sessionId: ctx.sessionId });
    return;
  }
  
  const isError = event.isError ?? false;
  
  logger.debug('tool_result', {
    sessionKey,
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    isError,
  });
  
  // Build result payload based on tool type
  const resultPayload: Record<string, unknown> = {
    isError,
  };
  
  if (config.captureToolOutputs && !isError) {
    if (event.toolName === 'bash') {
      const result = event.result as { exitCode?: number; stdout?: string; stderr?: string; durationMs?: number };
      resultPayload.exitCode = result.exitCode;
      resultPayload.stdout = result.stdout?.slice(0, config.maxOutputLength);
      resultPayload.stderr = result.stderr?.slice(0, config.maxOutputLength);
      resultPayload.durationMs = result.durationMs;
    } else if (event.toolName === 'read') {
      const result = event.result as { content?: string; lineCount?: number; encoding?: string };
      resultPayload.contentLength = result.content?.length;
      resultPayload.lineCount = result.lineCount;
      resultPayload.encoding = result.encoding;
    } else if (event.toolName === 'write') {
      const result = event.result as { success?: boolean; backupPath?: string };
      resultPayload.success = result.success;
      resultPayload.backupPath = result.backupPath;
    } else if (event.toolName === 'edit') {
      const result = event.result as { successCount?: number; failedCount?: number };
      resultPayload.successCount = result.successCount;
      resultPayload.failedCount = result.failedCount;
    }
  }
  
  await sessionManager.closeToolCallSpanWithResult(
    sessionKey,
    event.toolCallId,
    event.toolName,
    resultPayload,
    isError
  );
});
```

---

#### Task 2.4: Update createToolCallSpan Signature

**File**: `src/session-state.ts`

**Update method signature**:
```typescript
async createToolCallSpan(
  sessionKey: string,
  toolName: string,
  payload: Record<string, unknown>,
  schemaName: 'pi:tool:bash' | 'pi:tool:read' | 'pi:tool:write' | 'pi:tool:edit' | 'pi:tool_call' = 'pi:tool_call'
): Promise<string | null> {
  // ... existing implementation, but use schemaName parameter
  const spanId = await this.agent.createSpan(
    sessionKey,
    schemaName,  // Use specific schema
    payload,
    state.agentRunSpanId
  );
  // ... rest of method
}
```

---

## Testing Plan

### Test 1: Turn Spans - Single Turn

```bash
pi -p -e ./src/index.ts "What is 2+2?"
```

**Expected**:
```
pi:agent_run
  └─ pi:turn (0)
      └─ pi:assistant_response
```

**Verify**:
```bash
cd /home/sprite/typescript-sdk/packages/cli
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id ... | jq -r '.summaries[0].id')

bun ./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" ... \
  | jq '.summaries[] | select(.schema_name == "pi:turn") | {schema_name, payload}'
```

---

### Test 2: Turn Spans - Multi-Turn with Tools

```bash
pi -p -e ./src/index.ts "List files in this directory using bash"
```

**Expected**:
```
pi:agent_run
  └─ pi:turn (0)
      └─ pi:tool:bash
  └─ pi:turn (1)
      └─ pi:assistant_response
```

---

### Test 3: Tool Schemas - Bash

```bash
pi -p -e ./src/index.ts "Run: ls -la"
```

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" ... \
  | jq '.summaries[] | select(.schema_name == "pi:tool:bash") | {schema_name, payload}'
```

**Expected payload**:
```json
{
  "command": "ls -la",
  "exitCode": 0,
  "stdout": "...",
  "durationMs": 123
}
```

---

### Test 4: Tool Schemas - Read

```bash
pi -p -e ./src/index.ts "Read the file README.md"
```

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" ... \
  | jq '.summaries[] | select(.schema_name == "pi:tool:read") | {schema_name, payload}'
```

**Expected payload**:
```json
{
  "path": "README.md",
  "contentLength": 1234,
  "lineCount": 50
}
```

---

### Test 5: Combined - Multi-Turn with Multiple Tools

```bash
pi -p -e ./src/index.ts "Read src/index.ts, then count the lines"
```

**Expected**:
```
pi:agent_run
  ├─ pi:turn (0)
  │   └─ pi:tool:read
  ├─ pi:turn (1)
  │   └─ pi:tool:bash (wc -l)
  └─ pi:turn (2)
      └─ pi:assistant_response
```

---

## Acceptance Criteria

### Turn Spans
- [ ] `pi:turn` schema registered in `agent.ts`
- [ ] Turn tracking fields added to `SessionSpanState`
- [ ] `createTurnSpan` and `closeTurnSpan` methods implemented
- [ ] `turn_start` and `turn_end` hook handlers added
- [ ] Hook count updated to 15
- [ ] Turn spans are children of `pi:agent_run`
- [ ] Tool spans and assistant responses are children of turn spans
- [ ] Single-turn runs work (regression test)
- [ ] Multi-turn runs create separate turn spans

### Tool Schemas
- [ ] All 4 tool schemas registered (`pi:tool:bash`, `read`, `write`, `edit`)
- [ ] Tool handlers use specific schemas based on tool name
- [ ] Tool-specific payloads captured (command, path, exitCode, etc.)
- [ ] Unknown tools fall back to `pi:tool_call`
- [ ] Validated with Prefactor CLI

### General
- [ ] TypeScript compilation passes
- [ ] No regressions in existing functionality
- [ ] All spans show correct status (complete/failed)
- [ ] No spans remain "active" after exit
- [ ] Validated with Prefactor CLI

---

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `src/agent.ts` | Add turn + 4 tool schemas | ~150 |
| `src/session-state.ts` | Add turn tracking, update tool method | ~80 |
| `src/index.ts` | Add turn handlers, update tool handlers | ~120 |
| **Total** | **3 files** | **~350 lines** |

---

## Commit Message

```
feat: Add turn spans and tool-specific schemas

Turn Spans:
- Add pi:turn schema for tracking multi-turn agent runs
- Add turn tracking to SessionSpanState (currentTurnIndex, turnSpans)
- Add turn_start and turn_end hook handlers
- Turn spans are children of pi:agent_run
- Tool spans and assistant responses become children of turn spans

Tool-Specific Schemas:
- Add pi:tool:bash, pi:tool:read, pi:tool:write, pi:tool:edit schemas
- Update tool_execution_start to use specific schemas
- Update tool_result to capture tool-specific result data
- Unknown tools fall back to generic pi:tool_call schema

Validated with:
- Single-turn runs (regression)
- Multi-turn runs with tools
- Tool-specific payload verification
- Prefactor CLI span hierarchy checks
```

---

## Implementation Order

1. **Start with Turn Spans** (Tasks 1.1-1.4) - ~2 hours
2. **Then Tool Schemas** (Tasks 2.1-2.4) - ~3 hours
3. **Test both features together** - ~30 minutes
4. **Commit and validate** - ~30 minutes

**Total**: ~5 hours

---

**Ready to start!**
