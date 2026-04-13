# P0 Task: agent_run Span Improvements

**Priority**: P0 CRITICAL  
**Date**: 2026-04-13  
**Status**: Ready for implementation  

---

## Problem Statement

Current `pi:agent_run` span captures **redundant data** and **misses critical fields**:

### Current Payload (Problematic)
```json
{
  "messageCount": 0,                    // ← Always zero!
  "model": "qwen3.5:cloud",             // ✅ Good
  "provider": "ollama",                 // ✅ Good
  "startTime": 1776057308820,           // ← Redundant (can derive from children)
  "systemPromptHash": "013246c67e2e27c9" // ← USELESS without lookup table
}
```

### Current Result Payload (Problematic)
```json
{
  "commandsRun": 1,                     // ← Redundant (count bash spans)
  "durationMs": 19357,                  // ← Redundant (calculate from timestamps)
  "endTime": 1776057328177,             // ← Redundant (latest child timestamp)
  "filesCreated": [],                   // ← Redundant (query write spans)
  "filesModified": ["..."],             // ← Redundant (query write/edit spans)
  "filesRead": [],                      // ← Redundant (query read spans)
  "reason": "failed",                   // ← Contradicts success:true!
  "success": true,                      // ✅ Good but contradicts reason
  "toolCalls": 3                        // ← Redundant (count tool spans)
}
```

### Missing Critical Fields
- ❌ `systemPrompt` - Actual instructions (not hash!)
- ❌ `skillsLoaded` - Which skills active
- ❌ `toolsAvailable` - Which tools available
- ❌ `tokens` - Token usage for cost tracking
- ❌ `temperature` - Model config
- ❌ `userRequest` - What user asked
- ❌ `terminationReason` - Consistent end reason

---

## Your Mission

Implement **Phase 1 Critical Fixes** to make agent_run span **actually useful** for:
1. **Agent debugging** - Why did it do X?
2. **Code session evaluation** - Did it succeed? What changed?
3. **Team sharing** - What was accomplished?

---

## Implementation Tasks

### Task 1: Capture systemPrompt (Not Hash!)

**File**: `src/index.ts` (before_agent_start handler)

**Current**:
```typescript
systemPromptHash: createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16)
```

**Required**:
```typescript
// Capture actual system prompt (truncated to max length)
const maxSystemPromptLength = config.maxSystemPromptLength || 2000;
const systemPrompt = ctx.systemPrompt || '';

await sessionManager.createAgentRunSpan(sessionKey, {
  systemPrompt: systemPrompt.slice(0, maxSystemPromptLength),
  systemPromptHash: createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16), // Keep hash for dedup
  systemPromptLength: systemPrompt.length,
});
```

**Config** (src/config.ts):
```typescript
maxSystemPromptLength: z.number().default(2000),  // Capture first 2000 chars
```

**Acceptance Criteria**:
- [ ] systemPrompt field captures actual prompt text (first 2000 chars)
- [ ] systemPromptHash still captured (for dedup)
- [ ] systemPromptLength captured (full length)
- [ ] TypeScript compilation passes

---

### Task 2: Capture skillsLoaded

**File**: `src/index.ts` (before_agent_start handler)

**Required**:
```typescript
// Extract skills from context or session
const skillsLoaded = ctx.skills?.map(s => s.name) || [];

await sessionManager.createAgentRunSpan(sessionKey, {
  skillsLoaded,
});
```

**If skills not available in context**:
```typescript
// Track skills in session state when they're loaded
interface SessionSpanState {
  skillsLoaded: string[];  // Add to session-state.ts
}

// In session_start or skills_discover hook
state.skillsLoaded = event.skills?.map(s => s.name) || [];
```

**Acceptance Criteria**:
- [ ] skillsLoaded array captured in agent_run payload
- [ ] Lists skill names (e.g., ["sprite", "bash", "read", "write"])
- [ ] TypeScript compilation passes

---

### Task 3: Capture toolsAvailable

**File**: `src/index.ts` (before_agent_start handler)

**Required**:
```typescript
// Extract available tools from context
const toolsAvailable = ctx.tools?.map(t => t.name) || [];

await sessionManager.createAgentRunSpan(sessionKey, {
  toolsAvailable,
});
```

**Acceptance Criteria**:
- [ ] toolsAvailable array captured in agent_run payload
- [ ] Lists tool names (e.g., ["bash", "read", "write", "edit"])
- [ ] TypeScript compilation passes

---

### Task 4: Add Token Tracking

**File**: `src/index.ts` (agent_end handler)

**Required**:
```typescript
// Extract token usage from event or result
const usage = event.usage || (event.result as any)?.usage;

let tokens: { input: number; output: number; total: number } | undefined;

if (usage) {
  tokens = {
    input: usage.promptTokens || usage.input_tokens || 0,
    output: usage.completionTokens || usage.output_tokens || 0,
    total: usage.totalTokens || (usage.promptTokens + usage.completionTokens) || 0,
  };
}

await sessionManager.closeAgentRunSpan(sessionKey, {
  tokens,
});
```

**Also track per-tool tokens** (optional but useful):
```typescript
// In tool_result handler
const toolUsage = (event.result as any)?.usage;
if (toolUsage) {
  resultPayload.tokens = {
    input: toolUsage.promptTokens || 0,
    output: toolUsage.completionTokens || 0,
    total: toolUsage.totalTokens || 0,
  };
}
```

**Acceptance Criteria**:
- [ ] tokens object captured in agent_run result payload
- [ ] Includes input, output, total
- [ ] TypeScript compilation passes
- [ ] Test: Run session, verify tokens captured

---

### Task 5: Fix terminationReason (No Contradictions)

**File**: `src/index.ts` (agent_end handler)

**Current Problem**:
```json
{
  "reason": "failed",  // ← Contradicts
  "success": true      // ← this
}
```

**Required**:
```typescript
// Consistent termination reason
let terminationReason: 'completed' | 'error' | 'user_cancel' | 'timeout' | 'session_shutdown';

if (event.success === true) {
  terminationReason = 'completed';
} else if (event.error) {
  terminationReason = 'error';
} else if (event.reason === 'user_cancel') {
  terminationReason = 'user_cancel';
} else if (event.reason === 'timeout') {
  terminationReason = 'timeout';
} else {
  terminationReason = 'session_shutdown';  // Clean shutdown
}

await sessionManager.closeAgentRunSpan(sessionKey, {
  success: event.success ?? true,
  terminationReason,
  error: event.error || undefined,
  reason: undefined,  // Remove old 'reason' field
});
```

**Update Schema** (src/agent.ts):
```typescript
// In pi:agent_run result_schema
terminationReason: { 
  type: 'string', 
  description: 'Why session ended: completed, error, user_cancel, timeout, session_shutdown',
  enum: ['completed', 'error', 'user_cancel', 'timeout', 'session_shutdown']
},
success: { type: 'boolean', description: 'Whether session succeeded' },
error: { type: 'string', description: 'Error message if failed' },
```

**Acceptance Criteria**:
- [ ] terminationReason field added (enum values)
- [ ] NO contradiction between success and terminationReason
- [ ] Old 'reason' field removed
- [ ] TypeScript compilation passes

---

### Task 6: Fix messageCount (Actual Count)

**File**: `src/index.ts` (before_agent_start handler)

**Current Problem**: Always 0

**Required**:
```typescript
const messageCount = event.messages?.length || 0;

await sessionManager.createAgentRunSpan(sessionKey, {
  messageCount,
});
```

**Also track in session state** (for accuracy):
```typescript
// In session-state.ts
interface SessionSpanState {
  messageCount: number;  // Track actual count
}

// In input handler
state.messageCount++;
```

**Acceptance Criteria**:
- [ ] messageCount reflects actual message count
- [ ] Not always zero
- [ ] TypeScript compilation passes

---

### Task 7: Capture userRequest

**File**: `src/index.ts` (input handler or before_agent_start)

**Required**:
```typescript
// Capture first user message as the request
let userRequest: string | undefined;

pi.on("input", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  const state = sessionManager.getSessionState(sessionKey);
  
  // Capture first user message as the request
  if (state && !state.userRequest && event.source === 'user') {
    userRequest = event.text;
    state.userRequest = event.text;
  }
});

// Then in before_agent_start
await sessionManager.createAgentRunSpan(sessionKey, {
  userRequest: state?.userRequest,
});
```

**Add to session-state.ts**:
```typescript
interface SessionSpanState {
  userRequest?: string;  // First user message
}
```

**Acceptance Criteria**:
- [ ] userRequest captured in agent_run payload
- [ ] Contains first user message
- [ ] TypeScript compilation passes

---

### Task 8: Update agent_run Schema

**File**: `src/agent.ts`

**Update pi:agent_run schema**:

```typescript
{
  name: 'pi:agent_run',
  description: 'Agent execution session',
  template: 'Agent run {{ messageCount }} messages',
  params_schema: {
    type: 'object',
    properties: {
      // Configuration (unique value)
      model: { type: 'string', description: 'LLM model used' },
      provider: { type: 'string', description: 'Provider (ollama, openai, etc.)' },
      temperature: { type: 'number', description: 'Model temperature' },
      systemPrompt: { type: 'string', description: 'System prompt/instructions (first 2000 chars)' },
      systemPromptHash: { type: 'string', description: 'SHA256 hash of full system prompt' },
      systemPromptLength: { type: 'number', description: 'Full system prompt length in chars' },
      skillsLoaded: { type: 'array', items: { type: 'string' }, description: 'Skills loaded for this session' },
      toolsAvailable: { type: 'array', items: { type: 'string' }, description: 'Tools available' },
      
      // Context
      userRequest: { type: 'string', description: 'Original user request' },
      messageCount: { type: 'number', description: 'Messages in conversation' },
      
      // Timing
      startTime: { type: 'number', description: 'Start timestamp (ms)' },
    },
    required: ['model', 'provider', 'startTime'],
  },
  result_schema: {
    type: 'object',
    properties: {
      // Outcome (unique value)
      success: { type: 'boolean', description: 'Whether session succeeded' },
      terminationReason: { 
        type: 'string', 
        enum: ['completed', 'error', 'user_cancel', 'timeout', 'session_shutdown'],
        description: 'Why session ended'
      },
      error: { type: 'string', description: 'Error message if failed' },
      
      // Token usage (unique value)
      tokens: {
        type: 'object',
        properties: {
          input: { type: 'number', description: 'Input tokens' },
          output: { type: 'number', description: 'Output tokens' },
          total: { type: 'number', description: 'Total tokens' },
        },
      },
      
      // Convenience aggregations (could derive from children)
      filesModified: { type: 'array', items: { type: 'string' }, description: 'Files modified' },
      filesCreated: { type: 'array', items: { type: 'string' }, description: 'Files created' },
      commandsRun: { type: 'number', description: 'Bash commands executed' },
      toolCalls: { type: 'number', description: 'Total tool calls' },
      
      // Timing
      endTime: { type: 'number', description: 'End timestamp (ms)' },
      durationMs: { type: 'number', description: 'Duration in milliseconds' },
    },
    required: ['success', 'terminationReason', 'endTime'],
  },
}
```

**Acceptance Criteria**:
- [ ] Schema updated with all new fields
- [ ] TypeScript compilation passes
- [ ] Prefactor backend accepts spans

---

## Testing Requirements

### ⚠️ IMPORTANT: Use Timeouts for All Tests

**Every test must use timeout** to prevent hanging:
```bash
timeout 30 pi -p -e ./src/index.ts "your test command" 2>&1
```

---

### Test 1: systemPrompt Captured

**Command**:
```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
timeout 30 pi -p -e ./src/index.ts "Say hello" 2>&1
```

**Verify**:
```bash
cd /home/sprite/typescript-sdk/packages/cli
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID | jq -r '.summaries[0].id')
START="2026-04-13T00:00:00Z"
END="2026-04-13T23:59:59Z"

bun ./dist/bin/cli.js agent_spans list \
  --agent_instance_id "$INSTANCE_ID" \
  --start_time "$START" \
  --end_time "$END" \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload | {systemPrompt: .systemPrompt, systemPromptLength: .systemPromptLength, systemPromptHash: .systemPromptHash}'
```

**Expected**:
```json
{
  "systemPrompt": "You are a helpful coding assistant...",
  "systemPromptLength": 5432,
  "systemPromptHash": "013246c67e2e27c9"
}
```

**Acceptance**:
- ✅ systemPrompt contains actual text (not just hash)
- ✅ systemPromptLength shows full length
- ✅ systemPromptHash still present

---

### Test 2: skillsLoaded Captured

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.skillsLoaded'
```

**Expected**:
```json
["sprite", "bash", "read", "write", "edit"]
```

**Acceptance**:
- ✅ skillsLoaded array present
- ✅ Contains skill names

---

### Test 3: toolsAvailable Captured

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.toolsAvailable'
```

**Expected**:
```json
["bash", "read", "write", "edit"]
```

**Acceptance**:
- ✅ toolsAvailable array present
- ✅ Contains tool names

---

### Test 4: Token Tracking

**Command**:
```bash
timeout 30 pi -p -e ./src/index.ts "Create a file called test-tokens.txt with content 'token test'" 2>&1
```

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.tokens'
```

**Expected**:
```json
{
  "input": 1234,
  "output": 56,
  "total": 1290
}
```

**Acceptance**:
- ✅ tokens object present
- ✅ Has input, output, total
- ✅ Values are numbers > 0

---

### Test 5: terminationReason (No Contradictions)

**Command**:
```bash
timeout 30 pi -p -e ./src/index.ts "Run ls -la" 2>&1
```

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload | {success, terminationReason, error}'
```

**Expected** (successful session):
```json
{
  "success": true,
  "terminationReason": "completed",
  "error": null
}
```

**Acceptance**:
- ✅ NO contradiction (success:true with reason:"failed")
- ✅ terminationReason is one of: completed, error, user_cancel, timeout, session_shutdown
- ✅ error field present (null if success)

---

### Test 6: messageCount (Not Zero)

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.messageCount'
```

**Expected**:
```json
1  // or higher
```

**Acceptance**:
- ✅ messageCount > 0
- ✅ Reflects actual message count

---

### Test 7: userRequest Captured

**Command**:
```bash
timeout 30 pi -p -e ./src/index.ts "Create a test file with specific content" 2>&1
```

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.userRequest'
```

**Expected**:
```json
"Create a test file with specific content"
```

**Acceptance**:
- ✅ userRequest present
- ✅ Contains first user message

---

### Test 8: Complete Session Reconstruction

**Command**:
```bash
timeout 30 pi -p -e ./src/index.ts "Create a file called agent-run-test.txt with content 'Testing agent_run improvements', then read it back and run echo 'done'" 2>&1
```

**Verify** (can you answer all questions from Prefactor?):
```bash
# 1. What model was used?
bun ./dist/bin/cli.js agent_spans list ... | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.model'

# 2. What instructions? (systemPrompt)
bun ./dist/bin/cli.js agent_spans list ... | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.systemPrompt | .[0:100]'

# 3. What skills were active?
bun ./dist/bin/cli.js agent_spans list ... | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.skillsLoaded'

# 4. What did user ask?
bun ./dist/bin/cli.js agent_spans list ... | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.userRequest'

# 5. Did it succeed? (no contradictions)
bun ./dist/bin/cli.js agent_spans list ... | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload | {success, terminationReason}'

# 6. How many tokens?
bun ./dist/bin/cli.js agent_spans list ... | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.tokens'

# 7. What files changed?
bun ./dist/bin/cli.js agent_spans list ... | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.filesModified'
```

**Acceptance**:
- ✅ Can answer ALL 7 questions from Prefactor data alone
- ✅ NO contradictory data
- ✅ systemPrompt is actual text (not just hash)
- ✅ tokens captured
- ✅ skillsLoaded captured

---

## Implementation Checklist

### Phase 1: Config & Schema (30 min)

- [ ] Add `maxSystemPromptLength` to config.ts
- [ ] Update pi:agent_run schema in agent.ts
- [ ] Add terminationReason enum
- [ ] TypeScript compilation passes

### Phase 2: Payload Capture (60 min)

- [ ] Capture systemPrompt (not just hash) in before_agent_start
- [ ] Capture skillsLoaded in before_agent_start
- [ ] Capture toolsAvailable in before_agent_start
- [ ] Capture userRequest in input handler
- [ ] Fix messageCount (actual count)
- [ ] TypeScript compilation passes

### Phase 3: Token Tracking (30 min)

- [ ] Add token extraction in agent_end handler
- [ ] Add token tracking to tool_result (optional)
- [ ] Update result schema with tokens object
- [ ] Test: Verify tokens captured
- [ ] TypeScript compilation passes

### Phase 4: Fix terminationReason (20 min)

- [ ] Implement consistent terminationReason logic
- [ ] Remove old 'reason' field
- [ ] Add error field
- [ ] Test: Verify no contradictions
- [ ] TypeScript compilation passes

### Phase 5: Build & Validation (40 min)

- [ ] Build extension
- [ ] Run Test 1 (systemPrompt)
- [ ] Run Test 2 (skillsLoaded)
- [ ] Run Test 3 (toolsAvailable)
- [ ] Run Test 4 (tokens)
- [ ] Run Test 5 (terminationReason)
- [ ] Run Test 6 (messageCount)
- [ ] Run Test 7 (userRequest)
- [ ] Run Test 8 (complete reconstruction)
- [ ] All tests pass
- [ ] Commit with validation results

---

## Files to Modify

| File | Changes | Estimated Lines |
|------|---------|-----------------|
| `src/config.ts` | Add maxSystemPromptLength | +5 |
| `src/agent.ts` | Update pi:agent_run schema | +40 |
| `src/index.ts` | Capture new fields in handlers | +80 |
| `src/session-state.ts` | Add userRequest, skillsLoaded tracking | +15 |
| **Total** | **4 files** | **~140 lines** |

---

## Success Criteria

**Implementation is complete when**:

1. ✅ systemPrompt captures actual text (first 2000 chars)
2. ✅ skillsLoaded array captured
3. ✅ toolsAvailable array captured
4. ✅ tokens tracked (input, output, total)
5. ✅ terminationReason consistent (no contradictions)
6. ✅ messageCount actual (not zero)
7. ✅ userRequest captured (first user message)
8. ✅ All 8 tests pass
9. ✅ Can answer all 7 questions from Test 8
10. ✅ TypeScript compilation passes
11. ✅ Committed with validation results

---

## Critical Reminders

### ⚠️ ALWAYS USE TIMEOUTS

**Every pi test MUST use timeout**:
```bash
timeout 30 pi -p -e ./src/index.ts "test command" 2>&1
```

**Why**: pi agent can hang indefinitely without timeout.

### ⚠️ Build Before Testing

```bash
cd /home/sprite/typescript-sdk
bun run build
```

**Why**: Changes must be compiled before testing.

### ⚠️ Validate in Prefactor

**Always query Prefactor** to verify changes work:
```bash
bun ./dist/bin/cli.js agent_spans list ... | jq ...
```

**Why**: Logs don't guarantee data reaches backend.

---

## Out of Scope

These are **NOT** part of this task:

- ❌ Remove redundant aggregations (filesModified, etc.) - Keep for now
- ❌ Add diffs for file changes - Future enhancement
- ❌ Add test results tracking - Future enhancement
- ❌ Circuit breaker - Separate task
- ❌ Session summaries - Future enhancement

**Focus**: Make agent_run capture **unique value** fields that cannot be derived from child spans.

---

**Ready for implementation. Start by reading P0-AGENT-RUN-CRITIQUE.md for context, then implement systematically.**
