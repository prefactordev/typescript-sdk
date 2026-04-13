# Critical Analysis: agent_run Payload - What's Actually Valuable?

**Date**: 2026-04-13  
**Status**: Questioning current implementation  

---

## The Problem: Fixed Values = Noise

From recent sessions, **every single session has**:

```json
{
  "messageCount": 1,  // ← ALWAYS 1!
  "userRequest": "...",
  "model": "qwen3.5:cloud",
  "provider": "ollama"
}
```

**Critical question**: If `messageCount` is always 1, **why are we tracking it?**

---

## Why This Happens

Pi coding agent sessions are **single-turn by default**:
1. User sends message
2. Agent responds
3. Session ends

**Not like ChatGPT** where you have back-and-forth conversation.

Therefore:
- `messageCount: 1` for 99% of sessions
- `messageCount: 2` maybe if user sends follow-up
- **This field provides ZERO signal**

---

## Critical Analysis: Every Field in agent_run

### Payload Fields (Start)

| Field | Current | Varies? | Valuable? | Keep? |
|-------|---------|---------|-----------|-------|
| `messageCount` | Always 1 | ❌ No | ❌ **NO** | **REMOVE** |
| `model` | "qwen3.5:cloud" | ✅ Yes (if user changes) | ✅ Yes | Keep |
| `provider` | "ollama" | ✅ Yes (if configured) | ✅ Yes | Keep |
| `userRequest` | Varies | ✅ Yes | ✅ **CRITICAL** | Keep |
| `systemPrompt` | "" (Pi API limitation) | ⚠️ When available | ✅ Yes | Keep |
| `skillsLoaded` | [] (Pi API limitation) | ⚠️ When available | ✅ Yes | Keep |
| `toolsAvailable` | [] (Pi API limitation) | ⚠️ When available | ✅ Yes | Keep |
| `startTime` | Timestamp | ✅ Yes | ⚠️ Redundant | **REMOVE** (derive from session) |

### Result Payload (End)

| Field | Current | Varies? | Valuable? | Keep? |
|-------|---------|---------|-----------|-------|
| `success` | true/false | ✅ Yes | ✅ **CRITICAL** | Keep |
| `terminationReason` | "session_shutdown" | ✅ Sometimes | ✅ Yes | Keep |
| `error` | undefined/null | ✅ When fails | ✅ Yes | Keep |
| `filesModified` | [...] | ✅ Yes | ✅ **CRITICAL** | Keep |
| `filesCreated` | [] | ✅ Sometimes | ✅ Yes | Keep |
| `commandsRun` | 0-5 | ✅ Yes | ✅ Yes | Keep |
| `toolCalls` | 1-10 | ✅ Yes | ✅ Yes | Keep |
| `durationMs` | 5000-30000 | ✅ Yes | ✅ Yes | Keep |
| `endTime` | Timestamp | ✅ Yes | ⚠️ Redundant | **REMOVE** (derive from session) |
| `tokens` | undefined | ⚠️ When provider exposes | ✅ Yes | Keep |

---

## What Should We Remove?

### ❌ REMOVE: messageCount

**Why**: Always 1, provides zero signal.

**Code to remove**:
```typescript
// REMOVE from src/index.ts
const messageCount = event.messages?.length || 0;  // DELETE
state.messageCount = (state.messageCount || 0) + 1;  // DELETE

// REMOVE from agent_run payload
messageCount,  // DELETE
```

**Impact**: None. Field was always 1 anyway.

---

### ❌ REMOVE: startTime / endTime

**Why**: Redundant with span timestamps.

Pi backend already tracks:
- `started_at` on span
- `finished_at` on span
- Can calculate duration from these

**Code to remove**:
```typescript
// REMOVE from payload
startTime: Date.now(),  // DELETE

// REMOVE from result_payload
endTime: Date.now(),  // DELETE
```

**Keep**: `durationMs` (convenient aggregation, not derivable from backend timestamps due to timezone issues)

---

### ❌ REMOVE: provider

**Why**: Redundant with model.

If model is "qwen3.5:cloud", provider is implicitly "ollama".  
If model is "gpt-4", provider is implicitly "openai".

**Code to remove**:
```typescript
// REMOVE from payload
provider: ctx.model?.provider,  // DELETE
```

**Keep**: `model` (more specific)

---

## What Should We Keep?

### ✅ CRITICAL: userRequest

**Why**: Answers "What did user ask?" - fundamental for audit trail.

**Keep as-is**:
```typescript
userRequest: state?.userRequest,
```

---

### ✅ CRITICAL: success + terminationReason

**Why**: Answers "Did it succeed? Why did it end?"

**Keep as-is**:
```typescript
success: event.success ?? true,
terminationReason: ...,
error: event.error || undefined,
```

---

### ✅ CRITICAL: filesModified / filesCreated

**Why**: Answers "What files changed?" - essential for code sessions.

**Keep as-is**:
```typescript
filesModified: Array.from(state.filesModified),
filesCreated: state.filesCreated,
```

---

### ✅ CRITICAL: toolCalls / commandsRun

**Why**: Answers "How much work was done?" - activity level indicator.

**Keep as-is**:
```typescript
toolCalls: state.toolCalls,
commandsRun: state.commandsRun,
```

---

### ✅ CRITICAL: durationMs

**Why**: Answers "How long did it take?" - performance tracking.

**Keep as-is**:
```typescript
durationMs: endTime - startTime,
```

---

### ✅ CRITICAL: model

**Why**: Answers "Which LLM was used?" - debugging, cost tracking.

**Keep as-is**:
```typescript
model: ctx.model?.id || "unknown",
```

---

### ✅ KEEP (when available): systemPrompt / skillsLoaded / toolsAvailable

**Why**: Answers "What instructions? What capabilities?"

**Keep even though currently empty** - Pi API will expose these:
```typescript
systemPrompt: ...,
skillsLoaded: ...,
toolsAvailable: ...,
```

---

### ✅ KEEP (when available): tokens

**Why**: Answers "How much did it cost?" - essential for production.

**Keep even though currently undefined** - providers will expose:
```typescript
tokens: tokens || undefined,
```

---

## Proposed Minimal agent_run Payload

### Payload (Start)
```typescript
{
  // Agent configuration (CANNOT derive from children)
  model: string,                    // ✅ Which LLM
  userRequest?: string,             // ✅ What user asked
  systemPrompt?: string,            // ✅ Instructions (when Pi exposes)
  skillsLoaded?: string[],          // ✅ Capabilities (when Pi exposes)
  toolsAvailable?: string[],        // ✅ Tools (when Pi exposes)
}
```

### Result Payload (End)
```typescript
{
  // Outcome (CANNOT derive from children)
  success: boolean,                 // ✅ Did it succeed?
  terminationReason: string,        // ✅ Why did it end?
  error?: string,                   // ✅ What went wrong?
  
  // Activity (COULD derive, but convenient)
  filesModified: string[],          // ✅ What changed?
  filesCreated: string[],           // ✅ What was new?
  toolCalls: number,                // ✅ How much work?
  commandsRun: number,              // ✅ Bash activity?
  
  // Performance
  durationMs: number,               // ✅ How long?
  
  // Cost (when provider exposes)
  tokens?: { input, output, total }, // ✅ How much cost?
}
```

---

## Fields to Remove: Summary

| Field | Reason | Lines to Remove |
|-------|--------|-----------------|
| `messageCount` | Always 1, zero signal | ~10 lines |
| `startTime` | Redundant with span timestamps | ~5 lines |
| `endTime` | Redundant with span timestamps | ~5 lines |
| `provider` | Redundant with model | ~5 lines |
| **Total** | | **~25 lines** |

---

## Impact Analysis

### What Breaks If We Remove These?

**Nothing.** All queries can use:
- `started_at` / `finished_at` from span metadata (instead of startTime/endTime)
- `model` field (instead of provider)
- Just don't query messageCount (it was always 1 anyway)

### What Improves?

1. **Cleaner payloads** - Less noise, more signal
2. **Faster queries** - Less data to transmit
3. **Clearer semantics** - Every field has meaning
4. **Easier debugging** - Less confusion about what fields mean

---

## Implementation Plan

### Task 1: Remove messageCount

**Files**: `src/index.ts`, `src/session-state.ts`

```typescript
// REMOVE from src/index.ts (before_agent_start handler)
const messageCount = event.messages?.length || 0;  // DELETE
state.messageCount = (state.messageCount || 0) + 1;  // DELETE

// REMOVE from agent_run payload
await sessionManager.createAgentRunSpan(sessionKey, {
  messageCount,  // DELETE THIS LINE
  model: ...,
  // ... rest
});
```

```typescript
// REMOVE from src/session-state.ts
interface SessionSpanState {
  messageCount?: number;  // DELETE THIS LINE
  // ... rest
}
```

---

### Task 2: Remove startTime/endTime

**Files**: `src/index.ts`, `src/session-state.ts`

```typescript
// REMOVE from src/index.ts (before_agent_start handler)
const startTime = Date.now();  // DELETE (track locally, don't send to backend)

// REMOVE from payload
await sessionManager.createAgentRunSpan(sessionKey, {
  startTime,  // DELETE THIS LINE
  // ... rest
});

// REMOVE from agent_end handler
const endTime = Date.now();  // DELETE (track locally, don't send to backend)

await sessionManager.closeAgentRunSpan(sessionKey, {
  endTime,  // DELETE THIS LINE
  durationMs: endTime - startTime,  // KEEP durationMs
  // ... rest
});
```

---

### Task 3: Remove provider

**Files**: `src/index.ts`, `src/agent.ts`

```typescript
// REMOVE from src/index.ts (before_agent_start handler)
await sessionManager.createAgentRunSpan(sessionKey, {
  model: ctx.model?.id,
  provider: ctx.model?.provider,  // DELETE THIS LINE
  // ... rest
});
```

```typescript
// REMOVE from src/agent.ts schema
properties: {
  model: { type: 'string', ... },
  provider: { type: 'string', ... },  // DELETE THIS LINE
  // ... rest
}
```

---

### Task 4: Update Schema

**File**: `src/agent.ts`

Update `pi:agent_run` schema to remove fields.

---

### Task 5: Validate

**Test**: Run session, verify payload is minimal but complete.

```bash
timeout 30 pi -p -e ./src/index.ts "Create test file"

bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | {payload, result_payload}'
```

**Expected**:
```json
{
  "payload": {
    "model": "qwen3.5:cloud",
    "userRequest": "Create test file"
  },
  "result_payload": {
    "success": true,
    "terminationReason": "session_shutdown",
    "filesModified": ["..."],
    "toolCalls": 1,
    "durationMs": 5000
  }
}
```

**Acceptance**:
- ✅ NO messageCount
- ✅ NO startTime/endTime
- ✅ NO provider
- ✅ All critical fields present

---

## Success Criteria

**Cleanup is complete when**:

1. ✅ messageCount removed (always 1, zero signal)
2. ✅ startTime/endTime removed (redundant with span timestamps)
3. ✅ provider removed (redundant with model)
4. ✅ All critical fields kept (userRequest, success, filesModified, etc.)
5. ✅ Payload is minimal but complete
6. ✅ TypeScript compilation passes
7. ✅ Validated with real session

---

## Philosophy

**Every field should earn its place**:
- If it's always the same value → **REMOVE** (noise)
- If it can be derived from other data → **REMOVE** (redundant)
- If it answers a critical question → **KEEP** (signal)
- If it varies and is useful → **KEEP** (valuable)

**Current payload**: Mix of signal and noise  
**Target payload**: Pure signal

---

**Ready for implementation. Remove fields that don't earn their place.**
