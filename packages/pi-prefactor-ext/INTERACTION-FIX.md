# Critical Fix: Close Interaction Span in closeAllChildSpans

**Priority**: P0 CRITICAL  
**Effort**: ~15 minutes  

---

## Problem

In `closeAllChildSpans()`, the interaction span ID is cleared but the span is **never closed**:

```typescript
// Current code (WRONG)
state.interactionSpanId = null;  // ← Clears reference but doesn't close span!
```

**Result**: Interaction spans remain "active" forever.

---

## Root Cause

The `closeAllChildSpans` method:
1. Closes spans in `openSpans` map ✅
2. Clears tracking variables ❌ (without closing spans)

**Missing**: Explicit `finishSpan` call for interaction span.

---

## Solution

Add explicit span closing before clearing references:

```typescript
// Close interaction span if still open
if (state.interactionSpanId) {
  await this.agent.finishSpan(
    sessionKey,
    state.interactionSpanId,
    'complete',
    { reason: 'child_cleanup' }
  );
  state.interactionSpanId = null;
}
```

---

## Files to Modify

**File**: `src/session-state.ts`  
**Method**: `closeAllChildSpans`  
**Lines**: ~540-560

---

## Implementation

Replace the tracking variable clearing section with explicit span closing:

```typescript
// Close interaction span if still tracked
if (state.interactionSpanId) {
  this.logger.warn('closing_interaction_span', {
    sessionKey,
    spanId: state.interactionSpanId,
  });
  await this.agent.finishSpan(
    sessionKey,
    state.interactionSpanId,
    'complete',
    { reason: 'child_cleanup' }
  );
  state.interactionSpanId = null;
}

// Close session span if still tracked (shouldn't happen, but defensive)
if (state.sessionSpanId) {
  this.logger.warn('closing_session_span', {
    sessionKey,
    spanId: state.sessionSpanId,
  });
  await this.agent.finishSpan(
    sessionKey,
    state.sessionSpanId,
    'complete',
    { reason: 'child_cleanup' }
  );
  state.sessionSpanId = null;
}

// Clear other tracking arrays (these are just references, spans already closed)
state.toolCallSpans = [];
state.agentRunSpanId = null;
state.assistantResponseSpanId = null;
state.userMessageSpanId = null;
state.agentThinkingSpanId = null;
```

---

## Testing

```bash
# Run test
pi -p -e ./src/index.ts "What is 2+2?"

# Verify no active spans
cd /home/sprite/typescript-sdk/packages/cli
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list ... | jq -r '.summaries[0].id')
bun ./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" ... \
  | jq '[.summaries[] | select(.status == "active")] | length'
# Should be 0
```

---

## Acceptance Criteria

- [ ] Interaction spans closed in closeAllChildSpans
- [ ] Session spans closed defensively
- [ ] No spans remain "active" after exit
- [ ] Validated with Prefactor CLI
- [ ] TypeScript compilation passes

---

**Ready to start!**
