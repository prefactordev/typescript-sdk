# P1-3: Implement Turn Spans

**Priority**: HIGH (v0.0.2)  
**Effort**: ~2 hours  
**Status**: Ready for implementation  

---

## Problem Statement

Multi-turn agent runs (LLM → tools → LLM → tools) are not tracked individually. All turns are lumped into a single `pi:agent_run` span.

**Example Scenario**:
```
User: "Refactor this function"
Turn 0: Agent calls read tool
Turn 1: Agent calls edit tool  
Turn 2: Agent responds with summary
```

**Current**: All 3 turns in single `pi:agent_run`  
**Expected**: Each turn as `pi:turn` child of agent_run

---

## Desired Span Hierarchy

### Before (Current)
```
pi:agent_run
  ├─ pi:tool_call (read)
  ├─ pi:tool_call (edit)
  └─ pi:assistant_response
```

### After (With Turn Spans)
```
pi:agent_run
  ├─ pi:turn (turnIndex: 0)
  │   └─ pi:tool_call (read)
  ├─ pi:turn (turnIndex: 1)
  │   └─ pi:tool_call (edit)
  └─ pi:turn (turnIndex: 2)
      └─ pi:assistant_response
```

---

## Implementation Tasks

### Task 1: Add Turn Schema to agent.ts

**File**: `src/agent.ts`  
**Location**: In `agentSchemaVersion.span_type_schemas` array (around line 268)

**Add this schema** (after `pi:agent_thinking`):

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

**Validation**: Schema should be registered when agent initializes.

---

### Task 2: Add Turn Tracking to SessionSpanState

**File**: `src/session-state.ts`  
**Location**: In `SessionSpanState` interface (around line 20)

**Add these fields**:

```typescript
interface SessionSpanState {
  // ... existing fields
  
  // Turn tracking
  currentTurnIndex: number;
  turnSpans: Map<number, string>;  // turnIndex -> spanId
}
```

**Add these methods** (after existing span methods):

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
    this.logger.info('turn_span_created', { 
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
  this.logger.info('turn_span_closed', { sessionKey, turnIndex });
}
```

---

### Task 3: Add Hook Handlers in index.ts

**File**: `src/index.ts`

**Add these hook handlers** (after existing handlers, around line 280):

```typescript
// Turn tracking
pi.on("turn_start", async (event, ctx) => {
  const sessionKey = await sessionManager.getSessionKey(ctx.sessionId);
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
  const sessionKey = await sessionManager.getSessionKey(ctx.sessionId);
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

### Task 4: Update Hook Count

**File**: `src/index.ts`  
**Location**: In extension initialization (around line 15)

**Update hook count** from 11 to 13:
```typescript
logger.info('extension_initialized', {
  hooks: 13,  // Was: 11
  sessionTimeoutHours: config.sessionTimeoutHours,
  interactionTimeoutMinutes: config.userInteractionTimeoutMinutes,
});
```

---

## Testing Plan

### Test 1: Single Turn (Regression)

**Command**:
```bash
pi -p -e ./src/index.ts "What is 2+2?"
```

**Expected**:
- Single `pi:turn` span with `turnIndex: 0`
- Child of `pi:agent_run`
- Contains `pi:assistant_response`

**Verify**:
```bash
cd /home/sprite/typescript-sdk/packages/cli
./dist/bin/cli.js agent_spans list --agent_instance_id INSTANCE_ID ... \
  | jq '.summaries[] | select(.schema_name == "pi:turn")'
```

---

### Test 2: Multi-Turn with Tools

**Command**:
```bash
pi -p -e ./src/index.ts "Read the file README.md and tell me how many lines it has"
```

**Expected**:
```
pi:agent_run
  ├─ pi:turn (0)
  │   └─ pi:tool_call (read)
  └─ pi:turn (1)
      └─ pi:assistant_response
```

**Verify**:
```bash
# Check turn spans exist
./dist/bin/cli.js agent_spans list --agent_instance_id INSTANCE_ID ... \
  | jq '.summaries[] | select(.schema_name == "pi:turn") | {id, payload: .payload}'

# Check hierarchy (parent_span_id relationships)
./dist/bin/cli.js agent_spans list --agent_instance_id INSTANCE_ID ... \
  | jq '.summaries[] | {schema_name, parent_span_id}'
```

---

### Test 3: Multi-Turn with Multiple Tools

**Command**:
```bash
pi -p -e ./src/index.ts "List files in this directory, then read the largest file"
```

**Expected**:
```
pi:agent_run
  ├─ pi:turn (0)
  │   └─ pi:tool_call (bash: ls)
  ├─ pi:turn (1)
  │   └─ pi:tool_call (read)
  └─ pi:turn (2)
      └─ pi:assistant_response
```

---

## Acceptance Criteria

- [ ] `pi:turn` schema registered in `agent.ts`
- [ ] Turn tracking fields added to `SessionSpanState`
- [ ] `createTurnSpan` and `closeTurnSpan` methods implemented
- [ ] `turn_start` and `turn_end` hook handlers added
- [ ] Hook count updated to 13
- [ ] TypeScript compilation passes (`bun run typecheck`)
- [ ] Single-turn runs work (regression test)
- [ ] Multi-turn runs create separate turn spans
- [ ] Turn spans are children of `pi:agent_run`
- [ ] Tool spans and assistant responses are children of correct turn spans
- [ ] Validated with Prefactor CLI

---

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `src/agent.ts` | Add `pi:turn` schema | ~15 |
| `src/session-state.ts` | Add turn tracking fields + methods | ~60 |
| `src/index.ts` | Add hook handlers, update hook count | ~30 |
| **Total** | **3 files** | **~105 lines** |

---

## Commit Message

```
feat: Add turn spans for multi-turn agent tracking

- Add pi:turn schema to agentSchemaVersion
- Add turn tracking to SessionSpanState (currentTurnIndex, turnSpans)
- Add createTurnSpan and closeTurnSpan methods
- Add turn_start and turn_end hook handlers
- Turn spans are children of pi:agent_run
- Tool spans and assistant responses become children of turn spans

Validated with:
- Single-turn runs (regression)
- Multi-turn runs with tools
- Prefactor CLI span hierarchy verification
```

---

## After Implementation

1. **Run typecheck**: `bun run typecheck`
2. **Test with tmux agent**: Spawn instrumented agent to implement this task
3. **Verify spans**: Use Prefactor CLI to check turn spans created correctly
4. **Commit**: Use commit message above
5. **Ask for validation**: Request review of implementation

---

**Ready to start!**
