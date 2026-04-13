# Bug Fix: Spans Always Show "failed" Status

**Priority**: CRITICAL (P0)  
**Effort**: ~30 minutes  
**Status**: Ready for implementation  

---

## Problem

All spans (except session) show `"status": "failed"` in Prefactor backend, even when they complete successfully.

**Example from CLI**:
```json
{
  "schema_name": "pi:agent_run",
  "status": "failed",  // ❌ Should be "complete"
  "finished_at": "2026-04-13T00:46:31.218000Z"
}
{
  "schema_name": "pi:user_interaction",
  "status": "failed",  // ❌ Should be "complete"
  "finished_at": "2026-04-13T00:46:32.343000Z"
}
```

**Expected**:
- `pi:agent_run` → `"complete"` (when agent succeeds)
- `pi:user_interaction` → `"complete"` (normal shutdown)
- `pi:tool_call` → `"complete"` (when tool succeeds)

---

## Root Cause Analysis

**File**: `src/session-state.ts`  
**Method**: `closeAllChildSpans` (lines 331-352)

**Current Behavior**:
```typescript
private async closeAllChildSpans(sessionKey: string): Promise<void> {
  const state = this.sessions.get(sessionKey);
  if (!state || !this.agent) return;

  // Close tool spans
  for (const toolSpan of state.toolCallSpans) {
    await this.agent.finishSpan(sessionKey, toolSpan.spanId, 'failed');  // ❌ Always 'failed'
  }
  state.toolCallSpans = [];

  // Close agent run
  if (state.agentRunSpanId) {
    await this.agent.finishSpan(sessionKey, state.agentRunSpanId, 'failed');  // ❌ Always 'failed'
    state.agentRunSpanId = null;
  }

  // Close interaction
  if (state.interactionSpanId) {
    await this.agent.finishSpan(sessionKey, state.interactionSpanId, 'failed');  // ❌ Always 'failed'
    state.interactionSpanId = null;
  }
}
```

**Call Chain**:
```
session_shutdown 
  → closeSessionSpan 
    → closeAllChildSpans  // ← Marks everything 'failed'
      → finishSpan(spanId, 'failed')  // ❌
```

**The Bug**: 
1. Spans are **already properly closed** by their handlers:
   - `agent_end` → `closeAgentRunSpan(status)` → `'complete'` or `'failed'` based on `event.success`
   - `tool_result` → `closeToolCallSpanWithResult()` → `'complete'` or `'failed'` based on `isError`
   
2. Then `session_shutdown` calls `closeAllChildSpans` which **overwrites** the status to `'failed'` for any spans still in the tracking arrays.

3. **Why are spans still in tracking arrays?** Because they're not being **removed** when closed!

---

## Investigation Needed

Check if spans are being removed from tracking arrays after closing:

**Tool spans** (line 263 in session-state.ts):
```typescript
state.toolCallSpans = state.toolCallSpans.filter(e => e.spanId !== entry.spanId);
```
✅ This looks correct - removes after closing.

**Agent run span** (line 135 in session-state.ts):
```typescript
state.agentRunSpanId = null;  // ✅ Cleared after closing
```

**Interaction span**: Check if cleared...

---

## Hypothesis

The spans showing as "failed" are **orphaned spans** that were never properly closed by their handlers, then cleaned up by `closeAllChildSpans` with 'failed' status.

**Possible causes**:
1. `agent_end` hook not firing → agent_run never closed
2. `tool_result` hook not firing → tool_call never closed
3. Interaction span never closed explicitly

---

## Fix Strategy

### Option 1: Remove closeAllChildSpans from session_shutdown

**Change**: Only call `closeAllChildSpans` during **timeout cleanup**, not normal shutdown.

**Rationale**: If handlers are working correctly, all child spans should already be closed by session_shutdown time.

**Implementation**:
```typescript
// In src/index.ts session_shutdown handler
pi.on("session_shutdown", async (_event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  logger.info('session_shutdown', { sessionKey });
  // Remove: await sessionManager.closeSessionSpan(sessionKey);
  // Just close session span directly
  await agent.finishAgentInstance(sessionKey, 'complete');
});
```

**Risk**: Orphaned spans won't be closed.

---

### Option 2: Fix closeAllChildSpans to only close orphaned spans

**Change**: Only close spans that are **still non-null** (not already closed).

**Implementation**:
```typescript
private async closeAllChildSpans(sessionKey: string): Promise<void> {
  const state = this.sessions.get(sessionKey);
  if (!state || !this.agent) return;

  // Close orphaned tool spans (only if still in array)
  for (const toolSpan of state.toolCallSpans) {
    this.logger.warn('closing_orphaned_tool_span', { 
      sessionKey, 
      toolSpanId: toolSpan.spanId,
      toolName: toolSpan.toolName 
    });
    await this.agent.finishSpan(sessionKey, toolSpan.spanId, 'failed');
  }
  state.toolCallSpans = [];

  // Close orphaned agent run (only if still non-null)
  if (state.agentRunSpanId) {
    this.logger.warn('closing_orphaned_agent_run', { 
      sessionKey, 
      spanId: state.agentRunSpanId 
    });
    await this.agent.finishSpan(sessionKey, state.agentRunSpanId, 'failed');
    state.agentRunSpanId = null;
  }

  // Close orphaned interaction (only if still non-null)
  if (state.interactionSpanId) {
    this.logger.warn('closing_orphaned_interaction', { 
      sessionKey, 
      spanId: state.interactionSpanId 
    });
    await this.agent.finishSpan(sessionKey, state.interactionSpanId, 'failed');
    state.interactionSpanId = null;
  }
}
```

**Key**: Add logging to see **which** spans are being closed as orphans.

---

### Option 3: Debug First, Then Fix

**Step 1**: Add logging to understand what's happening:

```typescript
// In closeAgentRunSpan (session-state.ts)
async closeAgentRunSpan(
  sessionKey: string,
  status: 'complete' | 'failed' | 'cancelled' = 'complete'
): Promise<void> {
  if (!this.agent) return;
  const state = this.sessions.get(sessionKey);
  if (!state || !state.agentRunSpanId) return;

  const spanId = state.agentRunSpanId;
  state.agentRunSpanId = null;
  
  this.logger.info('agent_run_closing', { sessionKey, spanId, status });  // ← ADD
  
  await this.agent.finishSpan(sessionKey, spanId, status);
  this.logger.info('agent_run_span_closed', { sessionKey, spanId, status });
}
```

**Step 2**: Add logging to closeAllChildSpans:

```typescript
private async closeAllChildSpans(sessionKey: string): Promise<void> {
  const state = this.sessions.get(sessionKey);
  if (!state || !this.agent) return;

  this.logger.info('closeAllChildSpans_start', {  // ← ADD
    sessionKey,
    hasAgentRun: !!state.agentRunSpanId,
    hasInteraction: !!state.interactionSpanId,
    toolCallCount: state.toolCallSpans.length,
  });

  // ... rest of method with logging
}
```

**Step 3**: Test and check logs to see:
- Does `agent_end` fire?
- Does `closeAgentRunSpan` get called?
- Is `agentRunSpanId` already null when `closeAllChildSpans` runs?

---

## Recommended Approach

**Start with Option 3** (debug first), then apply Option 2 (fix closeAllChildSpans).

**Rationale**: Need to understand **why** spans aren't being closed properly before fixing.

---

## Implementation Tasks

### Task 1: Add Debug Logging

**File**: `src/session-state.ts`

**Add to `closeAgentRunSpan`** (around line 130):
```typescript
this.logger.info('agent_run_closing', { sessionKey, spanId, status });
```

**Add to `closeToolCallSpanWithResult`** (around line 260):
```typescript
this.logger.info('tool_call_closing', { sessionKey, spanId: entry.spanId, isError });
```

**Add to `closeAllChildSpans`** (around line 331):
```typescript
this.logger.info('closeAllChildSpans_start', {
  sessionKey,
  hasAgentRun: !!state.agentRunSpanId,
  hasInteraction: !!state.interactionSpanId,
  toolCallCount: state.toolCallSpans.length,
});
```

**Add to `closeSessionSpan`** (around line 100):
```typescript
this.logger.info('closeSessionSpan_start', {
  sessionKey,
  hasAgentRun: !!state.agentRunSpanId,
  hasInteraction: !!state.interactionSpanId,
  toolCallCount: state.toolCallSpans.length,
});
```

---

### Task 2: Test and Analyze Logs

**Test Command**:
```bash
pi -p -e ./src/index.ts "List files in this directory using bash"
```

**Check Logs**:
```bash
tmux capture-pane -t pi-fix-span-status -p -S -100 | grep -E "agent_run_closing|tool_call_closing|closeAllChildSpans"
```

**Expected** (if working correctly):
```
[agent_run_closing] status=complete
[agent_run_span_closed] status=complete
[closeAllChildSpans_start] hasAgentRun=false  // ← Should be false (already closed)
```

**If broken**:
```
[closeAllChildSpans_start] hasAgentRun=true  // ← Still has agent run!
[closing_orphaned_agent_run]  // ← This shouldn't happen
```

---

### Task 3: Apply Fix

Based on debug results, apply **Option 2** fix:

**File**: `src/session-state.ts`

**Change**: Add logging to `closeAllChildSpans` to show which spans are orphans.

**Optional**: Only close spans that are actually orphaned (non-null).

---

### Task 4: Validate Fix

**Test Commands**:
```bash
# Test 1: Simple question (no tools)
pi -p -e ./src/index.ts "What is 2+2?"

# Test 2: With tool call
pi -p -e ./src/index.ts "List files using bash"

# Test 3: Multi-turn
pi -p -e ./src/index.ts "Read README.md and count lines"
```

**Verify with CLI**:
```bash
cd /home/sprite/typescript-sdk/packages/cli
INSTANCE_ID=$(./dist/bin/cli.js agent_instances list --agent_id 01knv0ft674x99bmah4jyj5na21hx9sa | jq -r '.summaries[0].id')

./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" \
  --start_time 2026-04-13T00:00:00Z --end_time 2026-04-13T23:59:59Z \
  | jq '.summaries[] | {schema_name, status}'
```

**Expected**:
```json
{"schema_name": "pi:session", "status": "complete"}
{"schema_name": "pi:user_interaction", "status": "complete"}
{"schema_name": "pi:agent_run", "status": "complete"}
{"schema_name": "pi:tool_call", "status": "complete"}
```

---

## Acceptance Criteria

- [ ] Debug logging added to span closing methods
- [ ] Logs show when spans are closed by handlers
- [ ] Logs show when closeAllChildSpans runs
- [ ] Root cause identified (why spans aren't closed by handlers)
- [ ] Fix applied to prevent orphaned span cleanup
- [ ] All spans show "complete" status (when successful)
- [ ] Validated with Prefactor CLI
- [ ] No regressions in span hierarchy

---

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `src/session-state.ts` | Add debug logging, fix closeAllChildSpans | ~30 |
| **Total** | **1 file** | **~30 lines** |

---

## Commit Message

```
fix: Prevent spans from showing 'failed' status incorrectly

- Add debug logging to closeAgentRunSpan, closeToolCallSpanWithResult
- Add logging to closeAllChildSpans to track orphaned spans
- closeAllChildSpans now only closes truly orphaned spans
- Add warnings when closing orphaned spans (should be rare)

Root cause: closeAllChildSpans was marking all child spans as 'failed'
during session shutdown, even if they were already properly closed by
their respective handlers (agent_end, tool_result).

Now only closes spans that are still tracked (orphaned due to errors).
```

---

**Ready to start!**
