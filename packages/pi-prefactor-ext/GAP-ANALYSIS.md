# Gap Analysis: Pi-Prefactor Extension

**Date**: 2026-04-13  
**Assessment**: CRITICAL - Core requirements NOT met  

---

## Executive Summary

The current extension **fails to meet core requirements** for auditable logging, effectiveness assessment, and team sharing. While the span hierarchy exists, the data captured is insufficient to reconstruct what happened in a coding session.

**Critical Finding**: Looking at Prefactor, you CANNOT understand what the agent actually did. You can see that it ran a bash command, but not what command, what the output was, or whether it succeeded.

---

## What We Have

### Current Span Types (from live Prefactor data)

| Span Type | Status | Payload Captured | Parent |
|-----------|--------|------------------|--------|
| `pi:session` | active | `{createdAt}` | none |
| `pi:user_interaction` | active | `{startedAt}` | session |
| `pi:user_message` | active | `{text, timestamp}` | interaction |
| `pi:agent_run` | **failed** | `{messageCount: 0}` | interaction |
| `pi:tool_call` | active | `{toolCallId, toolName}` | agent_run |
| `pi:assistant_response` | active | `{text, model, provider}` | interaction |

### Defined But NOT Appearing in Data

| Span Type | Defined In | Why Not Used |
|-----------|------------|--------------|
| `pi:turn` | agent.ts | Hook exists but spans not showing in queries |
| `pi:agent_thinking` | agent.ts | Config-gated, may not be enabled |
| `pi:tool:bash` | agent.ts | **CRITICAL**: Code uses `pi:tool_call` instead |
| `pi:tool:read` | agent.ts | **CRITICAL**: Code uses `pi:tool_call` instead |
| `pi:tool:write` | agent.ts | **CRITICAL**: Code uses `pi:tool_call` instead |
| `pi:tool:edit` | agent.ts | **CRITICAL**: Code uses `pi:tool_call` instead |

### Hook Coverage

**Instrumented (15 hooks)**:
- ✅ session_start
- ✅ session_shutdown
- ✅ input
- ✅ before_agent_start
- ✅ agent_end
- ✅ turn_start
- ✅ turn_end
- ✅ tool_execution_start
- ✅ tool_result
- ✅ message_start
- ✅ message_end

**Missing hooks**:
- ❌ session_before_switch
- ❌ session_before_fork
- ❌ session_before_compact
- ❌ context
- ❌ before_provider_request
- ❌ model_select
- ❌ resources_discover

---

## What We Need (Core Requirements)

### Requirement 1: Auditable Log

**Minimum viable data**:
- [x] Session boundary (start time)
- [x] User request text
- [x] Tool execution (which tool)
- [ ] Tool inputs (what command, what file, what edits)
- [ ] Tool outputs (exit code, stdout, stderr, success/fail)
- [ ] Files modified (paths, diffs)
- [ ] Commands run (full command, cwd, exit code)
- [ ] Agent responses (text)
- [ ] Session outcome (success/fail, why)

**Current state**: ❌ **FAILS** - Cannot reconstruct what happened

### Requirement 2: Effectiveness Assessment

**Minimum viable data**:
- [ ] Time spent per task (duration tracking)
- [ ] Tool success/failure rates
- [ ] Number of attempts per task
- [ ] Token usage per operation
- [ ] Files modified count
- [ ] Lines added/removed
- [ ] Test results (pass/fail)
- [ ] Build results (success/fail)

**Current state**: ❌ **FAILS** - No metrics captured

### Requirement 3: Team Sharing

**Minimum viable data**:
- [ ] Session summary (what was accomplished)
- [ ] File changes (what code modified)
- [ ] Key decisions (why agent made choices)
- [ ] Issues encountered (what went wrong)
- [ ] Time/cost (duration, tokens)

**Current state**: ❌ **FAILS** - Cannot share meaningful session data

---

## Critical Gaps (Top 10)

### 1. Tool Spans Use Generic Schema Instead of Specific Types

**Problem**: Code creates `pi:tool_call` spans instead of `pi:tool:bash`, `pi:tool:read`, etc.

**Impact**: Cannot distinguish tool types, cannot capture tool-specific data

**Current code** (index.ts line ~340):
```typescript
const schemaName = `pi:tool:${event.toolName}` as 'pi:tool_call';  // Wrong!
```

**Should be**:
```typescript
const schemaName = `pi:tool:${event.toolName}` as 'pi:tool:bash' | 'pi:tool:read' | ...;
```

**Priority**: 🔴 CRITICAL

---

### 2. pi:agent_run Captures Useless Data

**Current**: `{messageCount: 0}`

**Should capture**:
```typescript
{
  model: string,           // Which model was used
  systemPromptHash: string, // Which instructions
  temperature: number,     // Config
  totalTokens: { input, output }, // Cost tracking
  durationMs: number,      // Performance
  success: boolean,        // Outcome
  filesModified: string[], // What changed
  commandsRun: number,     // Activity level
  toolCalls: number,       // Tool usage
}
```

**Priority**: 🔴 CRITICAL

---

### 3. No Duration Tracking Anywhere

**Problem**: No spans track how long operations took

**Impact**: Cannot measure performance, cannot identify bottlenecks

**Missing**:
- Start/end timestamps on all spans
- Duration calculation in result payloads
- Session total time

**Priority**: 🔴 CRITICAL

---

### 4. No Token Tracking

**Problem**: Token usage not captured anywhere

**Impact**: Cannot track costs, cannot optimize token usage

**Where to capture**:
- `pi:agent_run` - total tokens
- `pi:assistant_response` - output tokens
- `pi:agent_thinking` - thinking tokens

**Priority**: 🟠 HIGH

---

### 5. Tool Result Data Not Captured

**Problem**: `tool_result` hook captures result but doesn't include in span

**Current**: Tool spans have `{toolCallId, toolName}` only

**Should capture**:
- `pi:tool:bash`: `{command, cwd, exitCode, stdout, stderr, durationMs}`
- `pi:tool:read`: `{path, contentLength, lineCount}`
- `pi:tool:write`: `{path, contentLength, created, backupPath}`
- `pi:tool:edit`: `{path, editCount, successCount, failedCount}`

**Priority**: 🔴 CRITICAL

---

### 6. No File Change Tracking

**Problem**: Cannot see what files were modified

**Missing**:
- File paths for read/write/edit operations
- Diffs for edits
- Backup paths for writes
- Success/fail per file operation

**Priority**: 🔴 CRITICAL

---

### 7. No Outcome Tracking

**Problem**: Cannot tell if session succeeded or failed

**Current**: `pi:agent_run` marked as "failed" but no reason

**Should capture**:
- Success/fail boolean
- Error messages
- Exit reasons
- Task completion status

**Priority**: 🟠 HIGH

---

### 8. Turn Spans Not Visible in Data

**Problem**: Turn spans defined but not appearing in Prefactor queries

**Possible causes**:
- Not being created properly
- Parent span issues
- Timing issues (not flushed)

**Priority**: 🟡 MEDIUM

---

### 9. pi:user_interaction Adds No Value

**Problem**: Just a container span with `{startedAt}`, no meaningful data

**Recommendation**: Remove or merge with session span

**Priority**: 🟡 MEDIUM

---

### 10. No Session Summary

**Problem**: Cannot quickly understand what session accomplished

**Should capture**:
- Session type (interactive/batch)
- Request summary
- Files changed count
- Commands run count
- Duration
- Outcome

**Priority**: 🟠 HIGH

---

## Nice-to-Have (Future)

- [ ] Thinking/reasoning capture (currently config-gated)
- [ ] Model selection tracking
- [ ] Context compaction events
- [ ] Session fork/switch tracking
- [ ] Resource discovery tracking
- [ ] Provider request/response payloads
- [ ] Circuit breaker for API reliability

---

## Recommendations

### What to Keep

1. **Core span hierarchy**: session → interaction → agent_run → tools
2. **Hook instrumentation**: Current hooks are comprehensive
3. **Session state management**: Good foundation for tracking
4. **Replay queue**: Important for reliability

### What to Remove

1. **pi:user_interaction span**: Adds complexity, no value. Merge into session or remove.
2. **Turn spans** (if not valuable): Evaluate after fixing visibility issues
3. **message_start/message_end hooks**: Not adding value, remove

### What to Fix (Priority Order)

#### Phase 1: Critical Fixes (This Week)

1. **Fix tool span schema selection** - Use specific tool types, not generic
2. **Capture tool inputs/outputs** - Full command, exit code, stdout/stderr
3. **Add duration tracking** - Start/end timestamps on all spans
4. **Fix pi:agent_run payload** - Capture model, tokens, outcome, files modified
5. **Add file change tracking** - Paths, diffs, backup info

#### Phase 2: Important Improvements (Next Week)

6. **Add token tracking** - Input/output tokens per operation
7. **Add outcome tracking** - Success/fail with reasons
8. **Add session summary** - Quick overview of what happened
9. **Fix turn span visibility** - Debug why not appearing

#### Phase 3: Enhancements (Future)

10. **Add thinking capture** - Agent reasoning (config-gated)
11. **Add model selection tracking** - Which model used when
12. **Team sharing features** - Export, summaries, diffs

---

## Span Payload Recommendations

### pi:session

**Current**: `{createdAt: string}`

**Should Capture**:
```typescript
{
  createdAt: string,
  sessionType: 'interactive' | 'batch',
  sessionFile: string,
}
```

**Priority**: LOW

---

### pi:user_interaction

**Current**: `{startedAt: string}`

**Recommendation**: REMOVE - adds no value

**Priority**: REMOVE

---

### pi:user_message

**Current**: `{text: string, timestamp: string}`

**Should Capture**: (current is adequate)
```typescript
{
  text: string,
  timestamp: string,
  source: string,  // user, system, etc.
}
```

**Priority**: LOW

---

### pi:agent_run 🔴 CRITICAL

**Current**: `{messageCount: number}`

**Should Capture**:
```typescript
{
  messageCount: number,
  model: string,
  systemPromptHash: string,
  temperature: number,
  totalTokens: { input: number, output: number },
  durationMs: number,
  success: boolean,
  filesModified: string[],
  commandsRun: number,
  toolCalls: number,
  error?: string,
}
```

**Priority**: CRITICAL

---

### pi:tool_call (generic fallback)

**Current**: `{toolCallId: string, toolName: string}`

**Should Capture**: (keep as fallback only)
```typescript
{
  toolCallId: string,
  toolName: string,
  input?: Record<string, unknown>,
  output?: string,
  isError: boolean,
  durationMs?: number,
}
```

**Priority**: MEDIUM (should rarely be used)

---

### pi:tool:bash 🔴 CRITICAL

**Current**: NOT USED (code uses pi:tool_call instead)

**Should Capture**:
```typescript
{
  toolCallId: string,
  command: string,
  cwd: string,
  timeout?: number,
  // Result fields:
  exitCode: number,
  stdout: string,  // Truncated
  stderr: string,  // Truncated
  durationMs: number,
  isError: boolean,
}
```

**Priority**: CRITICAL

---

### pi:tool:read 🔴 CRITICAL

**Current**: NOT USED

**Should Capture**:
```typescript
{
  toolCallId: string,
  path: string,
  offset?: number,
  limit?: number,
  // Result fields:
  contentLength: number,
  lineCount: number,
  encoding: string,
  isError: boolean,
}
```

**Priority**: CRITICAL

---

### pi:tool:write 🔴 CRITICAL

**Current**: NOT USED

**Should Capture**:
```typescript
{
  toolCallId: string,
  path: string,
  contentLength: number,
  created: boolean,
  // Result fields:
  backupPath?: string,
  success: boolean,
  isError: boolean,
}
```

**Priority**: CRITICAL

---

### pi:tool:edit 🔴 CRITICAL

**Current**: NOT USED

**Should Capture**:
```typescript
{
  toolCallId: string,
  path: string,
  editCount: number,
  // Result fields:
  successCount: number,
  failedCount: number,
  oldTextHashes: string[],
  newTextLengths: number[],
  isError: boolean,
}
```

**Priority**: CRITICAL

---

### pi:assistant_response

**Current**: `{text: string, model: string, provider: string}`

**Should Capture**:
```typescript
{
  text: string,
  model: string,
  provider: string,
  tokens?: { input: number, output: number },
  durationMs?: number,
}
```

**Priority**: MEDIUM

---

### pi:agent_thinking

**Current**: NOT APPEARING IN DATA

**Should Capture**:
```typescript
{
  thinking: string,
  tokens?: { input: number, output: number },
  durationMs?: number,
}
```

**Priority**: LOW (nice-to-have)

---

### pi:turn

**Current**: NOT APPEARING IN DATA

**Should Capture**:
```typescript
{
  turnIndex: number,
  model: string,
  toolCallsCount: number,
  success: boolean,
  durationMs: number,
}
```

**Priority**: MEDIUM (debug first)

---

## Hook Priority List

### Critical (Must Have)

1. **session_start** - Session boundary
2. **session_shutdown** - Session complete
3. **input** - What user asked
4. **before_agent_start** - Agent config, model
5. **agent_end** - Agent outcome, success/fail
6. **tool_execution_start** - What agent is doing (inputs)
7. **tool_result** - What happened (outputs)

### Important (Should Have)

8. **turn_start** - Multi-turn tracking
9. **turn_end** - Turn completion
10. **message_end** - Response captured

### Nice-to-Have (Could Have)

11. **message_start** - Request received
12. **agent_thinking** - Reasoning (if enabled)

### Skip (Won't Have)

- **user_interaction** - Adds complexity, no value
- **message_start** - Redundant with input hook

---

## Implementation Plan

### Phase 1: Critical Fixes (This Week)

1. ✅ Fix tool span schema selection (use specific types)
2. ✅ Capture tool inputs/outputs fully
3. ✅ Add duration tracking to all spans
4. ✅ Fix pi:agent_run payload
5. ✅ Add file change tracking

### Phase 2: Important Improvements (Next Week)

6. Add token tracking
7. Add outcome tracking with reasons
8. Add session summary spans
9. Debug turn span visibility

### Phase 3: Enhancements (Future)

10. Add thinking capture
11. Add model selection tracking
12. Team sharing features

---

## Success Criteria

Assessment is complete when:

- [x] Gap analysis document created
- [x] Span payload recommendations documented
- [x] Hook priority list created
- [x] Implementation plan prioritized
- [ ] Top 3 critical fixes implemented
- [ ] Validated with real coding session
- [ ] Can answer from Prefactor alone:
  - What files were modified?
  - What commands were run?
  - Did anything fail? Why?
  - How long did it take?
  - Would a team member understand what happened?

---

## Test: Can You Reconstruct What Happened?

**Test session**: Instance `01kp236rp84x99bmk02bprfb6vknpj9j`

**Questions**:

1. **What was the user's original request?**
   - ✅ YES: "What files are in this directory?"

2. **What files did the agent read/modify?**
   - ❌ NO: No file operation spans visible

3. **What commands did it run?**
   - ❌ NO: Only see `toolName: "bash"`, no command text

4. **Did any tools fail? Why?**
   - ❌ NO: No exit codes, no stderr, no error info

5. **How long did the session take?**
   - ❌ NO: No duration tracking

6. **What was the final outcome?**
   - ⚠️ PARTIAL: Can see assistant response text, but no success/fail status

7. **Would another team member understand what was done?**
   - ❌ NO: Cannot see what command was run, what files were read, or whether it succeeded

**Verdict**: **FAILS** - Cannot reconstruct session from Prefactor data

---

## Conclusion

The current extension provides a **framework** for tracing but does not capture **actionable data**. The span hierarchy is reasonable, but the payloads are nearly empty.

**Critical fix needed**: The tool span schema selection is broken - it's using `pi:tool_call` for all tools instead of specific types like `pi:tool:bash`. This prevents capturing tool-specific data.

**Immediate action**: Fix tool schema selection, capture full tool inputs/outputs, add duration tracking.
