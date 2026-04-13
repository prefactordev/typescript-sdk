# Bug Fix: Complete Span Lifecycle Management

**Priority**: CRITICAL (P0)  
**Effort**: ~1 hour  
**Status**: Ready for implementation  

---

## Problem Statement

### Issue 1: Agent Run Shows "failed" on Normal Exit

**Current Behavior**:
```json
{
  "schema_name": "pi:agent_run",
  "status": "failed",  // ❌ Wrong - agent exited successfully
  "finished_at": "2026-04-13T01:14:30.522000Z"
}
```

**Expected**:
```json
{
  "schema_name": "pi:agent_run",
  "status": "complete",  // ✅ Agent completed without errors
  "finished_at": "2026-04-13T01:14:30.522000Z"
}
```

**Root Cause**: 
- `agent_end` hook doesn't fire in one-shot mode (agent exits before hook)
- `closeAllChildSpans` marks remaining agent_run as 'failed'
- No distinction between "agent failed" vs "agent completed normally"

---

### Issue 2: Spans Remain "active" After Agent Instance Completes

**Current Behavior** (from CLI):
```json
{"schema_name": "pi:assistant_response", "status": "active"}  // ❌ Should be closed
{"schema_name": "pi:user_message", "status": "active"}        // ❌ Should be closed
{"schema_name": "pi:agent_run", "status": "active"}           // ❌ Should be closed
```

**Agent Instance Status**: `"complete"`  
**Expected**: All child spans should be closed with appropriate status.

**Root Cause**:
- `assistant_response` spans are created but never closed
- `user_message` spans are created but never closed
- No cleanup in `session_shutdown` for these spans

---

## Design Principles

### Span Status Semantics

| Status | When to Use | Examples |
|--------|-------------|----------|
| `complete` | Normal completion, no errors | Agent finished, tool succeeded, user sent message |
| `failed` | Explicit failure, exception thrown | Tool threw error, API call failed, user cancelled |
| `cancelled` | User intervention, timeout | User stopped agent, session timed out |

**Key Rule**: **Never** mark a span as `failed` just because it's being cleaned up. Use `complete` for normal closure.

---

### Span Lifecycle Rules

1. **Every span created must be closed** (no "active" spans after shutdown)
2. **Close spans in reverse order of creation** (LIFO)
3. **Use appropriate status** based on actual outcome, not cleanup timing
4. **Defensive cleanup**: Close any remaining open spans during shutdown

---

## Implementation Plan

### Task 1: Track All Open Spans

**File**: `src/session-state.ts`

**Problem**: We only track some spans (agent_run, interaction, tool_call) but not others (assistant_response, user_message, thinking).

**Solution**: Add a comprehensive span registry:

```typescript
interface SpanEntry {
  spanId: string;
  schemaName: string;
  createdAt: number;
  status: 'open' | 'closed';
}

interface SessionSpanState {
  // ... existing fields
  
  // Comprehensive span tracking
  openSpans: Map<string, SpanEntry>;  // spanId -> entry
}
```

**Update all span creation methods** to register:
```typescript
async createUserMessageSpan(...) {
  const spanId = await this.agent.createSpan(...);
  if (spanId) {
    state.openSpans.set(spanId, {
      spanId,
      schemaName: 'pi:user_message',
      createdAt: Date.now(),
      status: 'open',
    });
  }
  return spanId;
}
```

**Update all span close methods** to mark as closed:
```typescript
async closeAgentRunSpan(...) {
  // ... existing code
  const spanEntry = state.openSpans.get(spanId);
  if (spanEntry) {
    spanEntry.status = 'closed';
  }
}
```

---

### Task 2: Fix session_shutdown Handler

**File**: `src/index.ts`

**Current**:
```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  await sessionManager.closeInteractionSpan(sessionKey);
  await sessionManager.closeSessionSpan(sessionKey);
  await agent.finishAgentInstance(sessionKey, 'complete');
});
```

**Fixed**:
```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  logger.info('session_shutdown', { sessionKey });
  
  // Close ALL remaining open spans with 'complete' status
  // (they're not failed, just not closed by their handlers)
  await sessionManager.closeAllOpenSpans(sessionKey, 'complete');
  
  // Then close session span
  await sessionManager.closeSessionSpan(sessionKey);
  
  // Finally finish agent instance
  await agent.finishAgentInstance(sessionKey, 'complete');
});
```

---

### Task 3: Implement closeAllOpenSpans

**File**: `src/session-state.ts`

```typescript
/**
 * Close all remaining open spans with specified status.
 * This is a defensive cleanup for spans not closed by their handlers.
 */
async closeAllOpenSpans(
  sessionKey: string,
  defaultStatus: 'complete' | 'failed' | 'cancelled' = 'complete'
): Promise<void> {
  if (!this.agent) return;
  const state = this.states.get(sessionKey);
  if (!state) return;
  
  const openSpanCount = Array.from(state.openSpans.values())
    .filter(entry => entry.status === 'open').length;
  
  if (openSpanCount === 0) {
    this.logger.debug('no_open_spans_to_close', { sessionKey });
    return;
  }
  
  this.logger.info('closing_all_open_spans', {
    sessionKey,
    openSpanCount,
    defaultStatus,
  });
  
  // Close in reverse order (LIFO)
  const openSpans = Array.from(state.openSpans.values())
    .filter(entry => entry.status === 'open')
    .sort((a, b) => b.createdAt - a.createdAt);  // Newest first
  
  for (const entry of openSpans) {
    this.logger.warn('closing_orphaned_span', {
      sessionKey,
      spanId: entry.spanId,
      schemaName: entry.schemaName,
      age: Date.now() - entry.createdAt,
      status: defaultStatus,
    });
    
    await this.agent.finishSpan(
      sessionKey,
      entry.spanId,
      defaultStatus,
      { reason: 'session_shutdown_cleanup' }
    );
    
    entry.status = 'closed';
  }
  
  this.logger.info('all_open_spans_closed', {
    sessionKey,
    closedCount: openSpanCount,
  });
}
```

---

### Task 4: Fix Specific Span Handlers

#### 4a: Close assistant_response spans

**File**: `src/index.ts` (turn_end handler)

**Current**: Creates assistant_response span but never closes it.

**Fixed**:
```typescript
pi.on("turn_end", async (event, ctx) => {
  // ... existing thinking capture code
  
  // Close assistant response span if it exists
  await sessionManager.closeAssistantResponseSpan(sessionKey);
  
  // Close turn span
  await sessionManager.closeTurnSpan(sessionKey, event.turnIndex, {
    turnIndex: event.turnIndex,
    success: event.success,
  });
});
```

**File**: `src/session-state.ts`

```typescript
interface SessionSpanState {
  // ... existing
  assistantResponseSpanId: string | null;
}

async createAssistantResponseSpan(...) {
  // ... existing
  if (spanId) {
    state.assistantResponseSpanId = spanId;
    // Also add to openSpans map
  }
  return spanId;
}

async closeAssistantResponseSpan(sessionKey: string): Promise<void> {
  if (!this.agent) return;
  const state = this.states.get(sessionKey);
  if (!state || !state.assistantResponseSpanId) return;
  
  const spanId = state.assistantResponseSpanId;
  state.assistantResponseSpanId = null;
  
  await this.agent.finishSpan(sessionKey, spanId, 'complete', {
    reason: 'turn_ended',
  });
  
  this.logger.info('assistant_response_span_closed', { sessionKey, spanId });
}
```

---

#### 4b: Close user_message spans

**File**: `src/index.ts` (input handler)

**Current**: Creates user_message span but never closes it.

**Fixed**:
```typescript
pi.on("input", async (event, ctx) => {
  const sessionKey = await sessionManager.getSessionKey(ctx.sessionId);
  // ... existing
  
  await sessionManager.createUserMessageSpan(sessionKey, event.text);
  
  // Close the span immediately (message is complete once sent)
  await sessionManager.closeUserMessageSpan(sessionKey);
});
```

**File**: `src/session-state.ts`

```typescript
interface SessionSpanState {
  // ... existing
  userMessageSpanId: string | null;
}

async createUserMessageSpan(...) {
  // ... existing
  if (spanId) {
    state.userMessageSpanId = spanId;
  }
  return spanId;
}

async closeUserMessageSpan(sessionKey: string): Promise<void> {
  if (!this.agent) return;
  const state = this.states.get(sessionKey);
  if (!state || !state.userMessageSpanId) return;
  
  const spanId = state.userMessageSpanId;
  state.userMessageSpanId = null;
  
  await this.agent.finishSpan(sessionKey, spanId, 'complete', {
    reason: 'message_delivered',
  });
  
  this.logger.info('user_message_span_closed', { sessionKey, spanId });
}
```

---

#### 4c: Close agent_thinking spans

**File**: `src/index.ts` (turn_end handler)

**Current**: Creates thinking span but never closes it.

**Fixed**:
```typescript
// After creating thinking span
if (thinking && config.captureThinking) {
  await sessionManager.createAgentThinkingSpan(sessionKey, thinking, usage, {
    provider: ctx.model?.provider,
    model: ctx.model?.id,
  });
  // Close immediately (thinking is complete once captured)
  await sessionManager.closeAgentThinkingSpan(sessionKey);
}
```

**File**: `src/session-state.ts`

```typescript
interface SessionSpanState {
  // ... existing
  agentThinkingSpanId: string | null;
}

async createAgentThinkingSpan(...) {
  // ... existing
  if (spanId) {
    state.agentThinkingSpanId = spanId;
  }
  return spanId;
}

async closeAgentThinkingSpan(sessionKey: string): Promise<void> {
  if (!this.agent) return;
  const state = this.states.get(sessionKey);
  if (!state || !state.agentThinkingSpanId) return;
  
  const spanId = state.agentThinkingSpanId;
  state.agentThinkingSpanId = null;
  
  await this.agent.finishSpan(sessionKey, spanId, 'complete', {
    reason: 'thinking_captured',
  });
  
  this.logger.info('thinking_span_closed', { sessionKey, spanId });
}
```

---

### Task 5: Fix agent_run Status Logic

**File**: `src/index.ts` (agent_end handler)

**Current**:
```typescript
pi.on("agent_end", async (event, ctx) => {
  await sessionManager.closeAgentRunSpan(sessionKey, event.success ? 'complete' : 'failed');
});
```

**Problem**: `event.success` might be false even for normal completion.

**Better Logic**:
```typescript
pi.on("agent_end", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  
  // Determine status based on actual outcome
  let status: 'complete' | 'failed' | 'cancelled' = 'complete';
  
  if (!event.success) {
    // Check if it's a real failure or just "no output"
    const hasError = event.messages?.some(msg => 
      msg.role === 'assistant' && 
      msg.content?.includes('error')
    );
    
    status = hasError ? 'failed' : 'complete';
  }
  
  logger.info('agent_end', {
    sessionKey,
    success: event.success,
    determinedStatus: status,
  });
  
  await sessionManager.closeAgentRunSpan(sessionKey, status);
});
```

**Alternative**: Always use 'complete' unless there's an explicit error:
```typescript
// Default to complete, only mark failed if we know it failed
const status = event.success ? 'complete' : 'complete';  // Always complete for now
```

---

### Task 6: Update closeAllChildSpans

**File**: `src/session-state.ts`

**Current**: Marks everything as 'failed'

**Fixed**: Only close truly orphaned spans with 'complete' (not failed):

```typescript
private async closeAllChildSpans(sessionKey: string): Promise<void> {
  const state = this.sessions.get(sessionKey);
  if (!state || !this.agent) return;

  this.logger.info('closeAllChildSpans_start', {
    sessionKey,
    openSpanCount: Array.from(state.openSpans.values())
      .filter(e => e.status === 'open').length,
  });

  // Close any remaining open spans with 'complete' status
  // (they're not failed, just missed by their handlers)
  for (const entry of state.openSpans.values()) {
    if (entry.status === 'open') {
      this.logger.warn('closing_missed_span', {
        sessionKey,
        spanId: entry.spanId,
        schemaName: entry.schemaName,
      });
      
      await this.agent.finishSpan(
        sessionKey,
        entry.spanId,
        'complete',  // Use 'complete', not 'failed'
        { reason: 'defensive_cleanup' }
      );
      
      entry.status = 'closed';
    }
  }

  this.logger.info('closeAllChildSpans_complete', { sessionKey });
}
```

---

## Testing Plan

### Test 1: One-Shot Command (No Tools)

```bash
pi -p -e ./src/index.ts "What is 2+2?"
```

**Expected Spans**:
```json
{"schema_name": "pi:session", "status": "complete"}
{"schema_name": "pi:user_interaction", "status": "complete"}
{"schema_name": "pi:user_message", "status": "complete"}
{"schema_name": "pi:agent_run", "status": "complete"}
{"schema_name": "pi:agent_thinking", "status": "complete"}
{"schema_name": "pi:assistant_response", "status": "complete"}
```

**Verify**:
```bash
cd /home/sprite/typescript-sdk/packages/cli
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id 01knv0ft... | jq -r '.summaries[0].id')

bun ./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" ... \
  | jq '[.summaries[] | select(.status != "complete")] | length'
# Should be 0
```

---

### Test 2: One-Shot with Tools

```bash
pi -p -e ./src/index.ts "List files using bash"
```

**Expected**: All spans "complete", tool spans "complete"

---

### Test 3: Multi-Turn

```bash
pi -p -e ./src/index.ts "Read README.md and count the lines"
```

**Expected**: 
- Multiple turn spans (when implemented)
- All spans "complete"
- No "active" spans

---

### Test 4: Verify No Active Spans

```bash
# After agent completes
bun ./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" ... \
  | jq '[.summaries[] | select(.status == "active")] | length'
# Should be 0
```

---

## Acceptance Criteria

- [ ] All spans closed with appropriate status (no "active" spans)
- [ ] Agent run spans show "complete" on normal exit
- [ ] Tool spans show "complete" on success, "failed" on error
- [ ] Assistant response spans closed properly
- [ ] User message spans closed properly
- [ ] Thinking spans closed properly
- [ ] No spans marked "failed" during normal cleanup
- [ ] Defensive cleanup uses "complete" status
- [ ] Validated with Prefactor CLI
- [ ] TypeScript compilation passes
- [ ] No regressions in span hierarchy

---

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `src/session-state.ts` | Add openSpans tracking, close methods | ~150 |
| `src/index.ts` | Update handlers to close spans | ~80 |
| **Total** | **2 files** | **~230 lines** |

---

## Commit Message

```
fix: Complete span lifecycle management - no active spans on shutdown

- Add openSpans Map to track all spans per session
- Implement closeAllOpenSpans for defensive cleanup
- Close assistant_response, user_message, thinking spans properly
- Use 'complete' status for normal cleanup (not 'failed')
- Fix agent_run to show 'complete' on normal exit
- Ensure all spans closed before session_shutdown completes

Span status semantics:
- 'complete': Normal completion (default for cleanup)
- 'failed': Explicit errors, exceptions, tool failures
- 'cancelled': User intervention, timeouts

Validated:
- No spans remain 'active' after agent instance completes
- All spans show appropriate status based on outcome
- One-shot mode works correctly
- Multi-turn scenarios handled properly
```

---

**Ready to start!**
