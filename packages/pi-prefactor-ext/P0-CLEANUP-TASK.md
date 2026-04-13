# P0 Cleanup: Remove Low-Value Spans

**Priority**: P0 CRITICAL  
**Date**: 2026-04-13  
**Status**: Ready for implementation  

---

## Problem

Per GAP-ANALYSIS.md, current spans include **low-value spans that add complexity without value**:

| Span Type | Problem | Recommendation |
|-----------|---------|----------------|
| `pi:user_interaction` | Container span with `{startedAt}` only, zero value | **REMOVE** |
| `pi:turn` | Adds complexity, unclear debugging value | **REMOVE** (or simplify heavily) |
| `pi:assistant_response` | Redundant with agent_run outcome | **REMOVE** |

**Result**: Prefactor shows cluttered hierarchy that obscures what actually happened.

---

## Current State (from live data)

```
pi:session (active)
  └─ pi:user_interaction (active) ← REMOVE
      ├─ pi:user_message (active)
      ├─ pi:agent_run (failed)
      │   └─ pi:tool:bash (active) ← GOOD
      └─ pi:assistant_response (active) ← REMOVE
```

**Problem**: 5 span types to understand a simple "run ls -la" operation.

---

## Target State

```
pi:session (active)
  └─ pi:user_message (active)
      └─ pi:agent_run (complete)
          └─ pi:tool:bash (complete) ← GOOD
```

**Result**: 3 span types, clear hierarchy, easy to understand.

---

## Changes Required

### 1. Remove `pi:user_interaction` Span

**Files to modify**:
- `src/session-state.ts` - Remove interactionSpanId tracking
- `src/index.ts` - Remove input handler creating interaction span

**Changes**:

```typescript
// REMOVE from session-state.ts
interface SessionSpanState {
  interactionSpanId: string | null;  // DELETE
  // ... keep other fields
}

// REMOVE from session-state.ts
async createOrGetInteractionSpan(): Promise<string> { ... }  // DELETE ENTIRE METHOD

// REMOVE from session-state.ts
async closeInteractionSpan(): Promise<void> { ... }  // DELETE ENTIRE METHOD

// UPDATE in session-state.ts
getInteractionParentSpanId(): string | null {
  return null;  // Always return null, tools will use agent_run as parent
}

// UPDATE in index.ts (input handler)
pi.on("input", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  pendingUserMessage = { text: event.text, timestamp: Date.now() };
  
  logger.debug('input', {
    sessionKey,
    textPreview: event.text.slice(0, 50),
    source: event.source,
  });
  
  // REMOVE: await sessionManager.createOrGetInteractionSpan(sessionKey);
  // Just create user_message span directly in before_agent_start
});
```

---

### 2. Remove `pi:turn` Spans

**Files to modify**:
- `src/agent.ts` - Remove turn span schemas
- `src/index.ts` - Remove turn_start/turn_end handlers

**Changes**:

```typescript
// REMOVE from agent.ts
{
  name: 'pi:turn',  // DELETE ENTIRE SCHEMA
  description: 'Agent turn in conversation',
  // ...
}

// REMOVE from index.ts
pi.on("turn_start", async (event, ctx) => { ... });  // DELETE

// REMOVE from index.ts
pi.on("turn_end", async (event, ctx) => { ... });  // DELETE
```

---

### 3. Remove `pi:assistant_response` Span

**Files to modify**:
- `src/agent.ts` - Remove schema
- `src/index.ts` - Remove creation in turn_end/agent_end

**Changes**:

```typescript
// REMOVE from agent.ts
{
  name: 'pi:assistant_response',  // DELETE ENTIRE SCHEMA
  description: 'Assistant response message',
  // ...
}

// REMOVE from index.ts (turn_end or agent_end handler)
await sessionManager.createAssistantResponseSpan(...);  // DELETE
```

---

### 4. Update Span Hierarchy

**New parent-child relationships**:

```
pi:session
  └─ pi:user_message
      └─ pi:agent_run
          ├─ pi:tool:bash
          ├─ pi:tool:read
          ├─ pi:tool:write
          └─ pi:tool:edit
```

**Changes needed**:
- `pi:user_message` parent: `pi:session`
- `pi:agent_run` parent: `pi:user_message`
- `pi:tool:*` parent: `pi:agent_run`

---

### 5. Update Hook Count

**Current**: 15 hooks  
**After cleanup**: 12 hooks

**Removed hooks**:
- turn_start
- turn_end
- (interaction span creation in input handler)

**Remaining hooks** (12):
1. session_start
2. session_shutdown
3. input
4. before_agent_start
5. agent_end
6. tool_execution_start
7. tool_result
8. message_start
9. message_end
10. (3 others as needed)

---

## Implementation Checklist

### Phase 1: Remove user_interaction (30 min)

- [ ] Remove `interactionSpanId` from SessionSpanState
- [ ] Remove `createOrGetInteractionSpan()` method
- [ ] Remove `closeInteractionSpan()` method
- [ ] Update `getInteractionParentSpanId()` to return null
- [ ] Remove interaction span creation from input handler
- [ ] Update all references to use agent_run as parent for tools
- [ ] TypeScript compilation passes

### Phase 2: Remove turn spans (20 min)

- [ ] Remove `pi:turn` schema from agent.ts
- [ ] Remove `turn_start` handler from index.ts
- [ ] Remove `turn_end` handler from index.ts
- [ ] Remove turn-related tracking from session-state.ts
- [ ] TypeScript compilation passes

### Phase 3: Remove assistant_response (15 min)

- [ ] Remove `pi:assistant_response` schema from agent.ts
- [ ] Remove assistant_response span creation
- [ ] Update agent_end to capture response in agent_run result
- [ ] TypeScript compilation passes

### Phase 4: Update parent-child relationships (20 min)

- [ ] Ensure pi:user_message uses pi:session as parent
- [ ] Ensure pi:agent_run uses pi:user_message as parent
- [ ] Ensure pi:tool:* uses pi:agent_run as parent
- [ ] Test span hierarchy in Prefactor

### Phase 5: Validation (30 min)

- [ ] Build extension
- [ ] Run test session
- [ ] Query Prefactor: verify only 3-4 span types appear
- [ ] Verify can still reconstruct what happened
- [ ] Commit changes

---

## Test: Verify Cleanup

**Command**:
```bash
pi -p -e ./src/index.ts "Run ls -la"
```

**Query Prefactor**:
```bash
cd /home/sprite/typescript-sdk/packages/cli
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID | jq -r '.summaries[0].id')
START="2026-04-13T00:00:00Z"
END="2026-04-13T23:59:59Z"

bun ./dist/bin/cli.js agent_spans list \
  --agent_instance_id "$INSTANCE_ID" \
  --start_time "$START" \
  --end_time "$END" \
  | jq '.summaries | group_by(.schema_name) | .[] | {schema: .[0].schema_name, count: length}'
```

**Expected Output** (3-4 span types max):
```json
[
  {"schema": "pi:session", "count": 1},
  {"schema": "pi:user_message", "count": 1},
  {"schema": "pi:agent_run", "count": 1},
  {"schema": "pi:tool:bash", "count": 1}
]
```

**Acceptance**:
- ✅ NO `pi:user_interaction` spans
- ✅ NO `pi:turn` spans
- ✅ NO `pi:assistant_response` spans
- ✅ Only 3-4 span types total
- ✅ Can still understand what happened from Prefactor

---

## Success Criteria

**Cleanup is complete when**:

1. ✅ Only essential spans remain (session, user_message, agent_run, tool:*)
2. ✅ Span hierarchy is clean and simple (3-4 levels max)
3. ✅ Can still reconstruct what the agent did
4. ✅ No references to removed spans in code
5. ✅ TypeScript compilation passes
6. ✅ Tests pass with new hierarchy
7. ✅ Committed with validation results

---

## Rationale

**Why remove these spans?**

From GAP-ANALYSIS.md:

> **pi:user_interaction**: "Just a container span with `{startedAt}`, no meaningful data. Adds complexity, zero value."

> **pi:turn**: "Adds complexity, unclear debugging value. Evaluate after fixing visibility issues."

> **pi:assistant_response**: "Redundant with agent_run outcome. Response text can be captured in agent_run result."

**Goal**: Minimal span types that capture **actionable data**, not structural overhead.

---

**Ready for implementation. Focus on simplicity and clarity.**
