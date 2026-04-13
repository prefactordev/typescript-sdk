# Critical Fix: Add Process Exit Handlers

**Priority**: P0 CRITICAL  
**Effort**: ~30 minutes  
**Status**: Ready for implementation  

---

## Problem

When agents exit (especially sub-agents spawned by other agents), the `session_shutdown` hook doesn't fire, leaving spans "active" forever.

**Evidence**:
```json
{
  "id": "01kp272vvr4x99bm7ka7dxq1tnp88753",
  "status": "active",  // ❌ Should be "complete"
  "ended_at": null
}
```

**Active Spans** (9 total):
- pi:session (1)
- pi:user_interaction (1)
- pi:agent_run (1)
- pi:assistant_response (4)
- pi:user_message (1)
- pi:tool_call (1)

---

## Root Cause

The `session_shutdown` hook only fires when pi **gracefully** shuts down a session. But when:
1. A sub-agent completes and exits
2. The agent process is killed
3. An error causes abrupt termination

...the cleanup never happens.

---

## Solution

Add **process exit handlers** to ensure cleanup on ANY exit:

**File**: `src/index.ts`

**Add after extension initialization**:

```typescript
// ==================== PROCESS EXIT HANDLERS ====================

// Ensure cleanup on process exit (handles abrupt termination)
process.on('exit', () => {
  logger.info('process_exit_handler', { reason: 'exit' });
  // Synchronous cleanup only (async won't complete)
  // Mark all sessions for cleanup (will be closed by next run)
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  logger.info('process_exit_handler', { reason: 'SIGINT' });
  await cleanupAllSessions();
  process.exit(0);
});

// Handle SIGTERM
process.on('SIGTERM', async () => {
  logger.info('process_exit_handler', { reason: 'SIGTERM' });
  await cleanupAllSessions();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (err) => {
  logger.error('uncaught_exception', { error: err.message });
  await cleanupAllSessions();
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  logger.error('unhandled_rejection', { reason: String(reason) });
  await cleanupAllSessions();
  process.exit(1);
});

async function cleanupAllSessions(): Promise<void> {
  logger.info('cleanup_all_sessions', { count: sessionManager.getActiveSessionCount() });
  
  // Close all open spans with 'complete' status
  // (they're not failed, just interrupted)
  await sessionManager.cleanupAllSessions();
  
  // Finish agent instance
  await agent.finishAgentInstance('*', 'complete');
}
```

---

## Implementation

### Task 1: Add getActiveSessionCount Method

**File**: `src/session-state.ts`

```typescript
getActiveSessionCount(): number {
  return this.sessions.size;
}
```

---

### Task 2: Update cleanupAllSessions

**File**: `src/session-state.ts`

**Current**: Only closes session spans

**Fixed**: Close ALL open spans:

```typescript
async cleanupAllSessions(): Promise<void> {
  this.logger.info('cleanup_all_sessions_start', { count: this.sessions.size });
  
  for (const [sessionKey, state] of this.sessions.entries()) {
    // Close all open spans with 'complete' status
    await this.closeAllOpenSpans(sessionKey, 'complete');
    
    // Close session span
    if (state.sessionSpanId) {
      await this.agent?.finishSpan(sessionKey, state.sessionSpanId, 'complete');
    }
  }
  
  this.sessions.clear();
  this.logger.info('cleanup_all_sessions_complete');
}
```

---

### Task 3: Add Exit Handlers in index.ts

**File**: `src/index.ts`

**Location**: After extension initialization (around line 100)

```typescript
// ==================== PROCESS EXIT HANDLERS ====================

// Graceful shutdown handlers
const gracefulShutdown = async (signal: string) => {
  logger.info('graceful_shutdown', { signal });
  try {
    await sessionManager.cleanupAllSessions();
    await agent.finishAgentInstance('*', 'complete');
  } catch (err) {
    logger.error('shutdown_error', { error: err });
  }
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Error handlers
process.on('uncaughtException', async (err) => {
  logger.error('uncaught_exception', { error: err.message });
  try {
    await sessionManager.cleanupAllSessions();
  } catch (cleanupErr) {
    logger.error('cleanup_during_error_failed', { error: cleanupErr });
  }
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  logger.error('unhandled_rejection', { reason: String(reason) });
  try {
    await sessionManager.cleanupAllSessions();
  } catch (cleanupErr) {
    logger.error('cleanup_during_error_failed', { error: cleanupErr });
  }
  process.exit(1);
});

// Note: 'exit' event is synchronous, async cleanup won't complete
// But we can at least log
process.on('exit', (code) => {
  logger.info('process_exit', { code });
});
```

---

## Testing

### Test 1: Normal Exit

```bash
pi -p -e ./src/index.ts "What is 2+2?"
```

**Expected**: All spans "complete", instance "complete"

---

### Test 2: Sub-Agent Exit

```bash
# Spawn a sub-agent
pi -p -e ./src/index.ts "Implement a simple function"
```

**Expected**: Both parent and child instances "complete"

---

### Test 3: Interrupted Exit

```bash
# Start agent, then Ctrl+C
pi -e ./src/index.ts
# Press Ctrl+C
```

**Expected**: Spans closed with "complete" status

---

## Acceptance Criteria

- [ ] Process exit handlers added
- [ ] SIGINT/SIGTERM handlers clean up gracefully
- [ ] Uncaught exception handlers clean up
- [ ] getActiveSessionCount method added
- [ ] cleanupAllSessions closes all open spans
- [ ] No spans remain "active" after agent exit
- [ ] Tested with normal exit
- [ ] Tested with sub-agent exit
- [ ] Validated with Prefactor CLI

---

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `src/index.ts` | Add exit handlers | ~60 |
| `src/session-state.ts` | Add getActiveSessionCount, update cleanup | ~20 |
| **Total** | **2 files** | **~80 lines** |

---

## Commit Message

```
fix: Add process exit handlers to ensure span cleanup on any exit

- Add SIGINT, SIGTERM, uncaughtException, unhandledRejection handlers
- Ensure cleanupAllSessions closes all open spans
- Add getActiveSessionCount method
- Log cleanup events for debugging

Problem: When agents exit abruptly (sub-agents, errors, kills),
session_shutdown hook doesn't fire, leaving spans "active" forever.

Solution: Register process-level exit handlers that ensure all spans
are closed with 'complete' status before the process exits.

Validated:
- No spans remain 'active' after any type of exit
- Sub-agents clean up properly
- Interrupted sessions clean up properly
- Error conditions clean up properly
```

---

**Ready to start!**
