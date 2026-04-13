# P0 Cleanup: Remove Noise Fields from agent_run

**Priority**: P0 - Data Quality  
**Date**: 2026-04-13  
**Status**: Ready for implementation  

---

## Problem

Current `agent_run` payload includes fields that provide **zero signal**:

```json
{
  "messageCount": 1,      // ← ALWAYS 1! Remove.
  "startTime": 1234567,   // ← Redundant with span.started_at. Remove.
  "provider": "ollama",   // ← Redundant with model. Remove.
  "userRequest": "...",   // ✅ KEEP - Critical!
  "model": "qwen3.5:cloud" // ✅ KEEP - Critical!
}
```

**Philosophy**: Every field must earn its place.
- Always same value? → **REMOVE** (noise)
- Redundant with other data? → **REMOVE** (duplicate)
- Answers critical question? → **KEEP** (signal)
- Varies and useful? → **KEEP** (valuable)

---

## Fields to Remove

### 1. messageCount ❌

**Why**: Always 1 in pi coding agent sessions (single-turn by default).

**Impact**: Zero. Field provides no signal.

---

### 2. startTime / endTime ❌

**Why**: Pi backend already tracks `started_at` / `finished_at` on spans.

**Impact**: None. Duration still tracked via `durationMs`.

---

### 3. provider ❌

**Why**: Redundant with model.
- "qwen3.5:cloud" → implicitly ollama
- "gpt-4" → implicitly openai

**Impact**: None. Model field is more specific.

---

## Fields to Keep

### ✅ Critical Fields (Keep)

| Field | Why Keep? |
|-------|-----------|
| `userRequest` | Answers "What did user ask?" |
| `model` | Answers "Which LLM?" |
| `systemPrompt` | Answers "What instructions?" (when Pi exposes) |
| `skillsLoaded` | Answers "What capabilities?" (when Pi exposes) |
| `toolsAvailable` | Answers "What tools?" (when Pi exposes) |
| `success` | Answers "Did it succeed?" |
| `terminationReason` | Answers "Why did it end?" |
| `error` | Answers "What went wrong?" |
| `filesModified` | Answers "What changed?" |
| `filesCreated` | Answers "What was new?" |
| `toolCalls` | Answers "How much work?" |
| `commandsRun` | Answers "Bash activity?" |
| `durationMs` | Answers "How long?" |
| `tokens` | Answers "How much cost?" (when provider exposes) |

---

## Implementation

### Task 1: Remove messageCount

**File**: `src/index.ts`

```typescript
// In before_agent_start handler
- const messageCount = event.messages?.length || 0;
- const state = sessionManager.getSessionState(sessionKey);
- if (state) {
-   state.messageCount = (state.messageCount || 0) + 1;
- }

  await sessionManager.createAgentRunSpan(sessionKey, {
-   messageCount,
    model: ctx.model?.id || "unknown",
    userRequest: state?.userRequest,
    // ... rest
  });
```

**File**: `src/session-state.ts`

```typescript
interface SessionSpanState {
  // REMOVE:
  // messageCount?: number;
  
  // Keep:
  userRequest?: string;
  filesModified: Set<string>;
  // ... rest
}
```

---

### Task 2: Remove startTime/endTime

**File**: `src/index.ts`

```typescript
// In before_agent_start handler
- const startTime = Date.now();

  await sessionManager.createAgentRunSpan(sessionKey, {
-   startTime,
    model: ctx.model?.id || "unknown",
    // ... rest
  });

// In agent_end handler
- const endTime = Date.now();
  const state = sessionManager.getSessionState(sessionKey);
  
  await sessionManager.closeAgentRunSpan(sessionKey, 'complete', {
-   endTime,
    durationMs: Date.now() - startTime,  // Keep durationMs!
    success: event.success ?? true,
    // ... rest
  });
```

**Note**: Keep tracking startTime/endTime **locally** for duration calculation, just don't send to backend.

---

### Task 3: Remove provider

**File**: `src/index.ts`

```typescript
// In before_agent_start handler
  await sessionManager.createAgentRunSpan(sessionKey, {
    model: ctx.model?.id || "unknown",
-   provider: ctx.model?.provider,
    userRequest: state?.userRequest,
    // ... rest
  });
```

**File**: `src/agent.ts`

```typescript
// In pi:agent_run schema
  params_schema: {
    properties: {
      model: { type: 'string', ... },
-     provider: { type: 'string', ... },
      userRequest: { type: 'string', ... },
      // ... rest
    }
  }
```

---

### Task 4: Update Documentation

**File**: `P0-PAYLOAD-CRITIQUE.md`

Update to reflect final state.

---

## Testing

### Test 1: Payload is Minimal

**Command**:
```bash
timeout 30 pi -p -e ./src/index.ts "Create test file" 2>&1
```

**Verify**:
```bash
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID | jq -r '.summaries[0].id')

bun ./dist/bin/cli.js agent_spans list \
  --agent_instance_id "$INSTANCE_ID" \
  --start_time "2026-04-13T00:00:00Z" \
  --end_time "2026-04-13T23:59:59Z" \
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
- ✅ NO startTime
- ✅ NO endTime
- ✅ NO provider
- ✅ All critical fields present

---

### Test 2: Duration Still Tracked

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.durationMs'
```

**Expected**: `5000` (or similar, > 0)

**Acceptance**:
- ✅ durationMs present
- ✅ Value is reasonable

---

### Test 3: All Questions Answerable

**Verify** (can answer all from Prefactor):

| Question | Field | Test |
|----------|-------|------|
| What did user ask? | userRequest | ✅ |
| Which LLM? | model | ✅ |
| Did it succeed? | success | ✅ |
| Why did it end? | terminationReason | ✅ |
| What changed? | filesModified | ✅ |
| How much work? | toolCalls | ✅ |
| How long? | durationMs | ✅ |

**Acceptance**: All 7 questions answerable

---

## Success Criteria

**Cleanup is complete when**:

1. ✅ messageCount removed (always 1, zero signal)
2. ✅ startTime removed (redundant)
3. ✅ endTime removed (redundant)
4. ✅ provider removed (redundant)
5. ✅ durationMs still tracked (convenient)
6. ✅ All critical fields kept
7. ✅ Payload is minimal but complete
8. ✅ TypeScript compilation passes
9. ✅ Validated with real session
10. ✅ Committed with validation

---

## Impact

### Before (Noise + Signal)
```json
{
  "messageCount": 1,      // ❌ Noise
  "startTime": 1234567,   // ❌ Redundant
  "provider": "ollama",   // ❌ Redundant
  "userRequest": "...",   // ✅ Signal
  "model": "qwen3.5:cloud" // ✅ Signal
}
```

### After (Pure Signal)
```json
{
  "userRequest": "...",   // ✅ Signal
  "model": "qwen3.5:cloud" // ✅ Signal
}
```

**Result**: 40% smaller payload, 100% signal, 0% noise.

---

**Ready for implementation. Remove fields that don't earn their place.**
