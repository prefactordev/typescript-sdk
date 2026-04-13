# Pi-Prefactor Extension Development Guide

**Date**: 2026-04-13  
**Status**: Production-Ready (v0.0.1-mvp)  
**Maintainer**: Development Team

---

## Overview

This guide documents the development process, debugging approach, and best practices for working on the pi-prefactor extension. It includes lessons learned from the MVP development and P0 critical fixes.

---

## Table of Contents

1. [What's Been Done](#whats-been-done)
2. [Debugging Methodology](#debugging-methodology)
3. [Tmux Sub-Agent Workflow](#tmux-sub-agent-workflow)
4. [Instrumentation Best Practices](#instrumentation-best-practices)
5. [Proposed Future Fixes](#proposed-future-fixes)
6. [Quick Reference](#quick-reference)

---

## What's Been Done

### Phase 1: MVP Implementation (11 hooks)

**Commit**: `4cb7d4a` through `ab9eaa1`

**Implemented Hooks**:
- `session_start` / `session_shutdown` - Session lifecycle
- `input` - User message capture
- `before_agent_start` / `agent_end` - Agent execution tracking
- `turn_end` - LLM response capture
- `tool_execution_start` / `tool_result` - Tool call tracking
- `message_start` / `message_end` - Message streaming (debug only)

**Span Types Created**:
- `pi:session` - Root span (24hr lifetime)
- `pi:user_interaction` - User interaction context (5min timeout)
- `pi:user_message` - Inbound user messages
- `pi:agent_run` - Agent execution runs
- `pi:tool_call` - Tool executions
- `pi:assistant_response` - LLM responses

**Validated**: ✅ All hooks fire correctly, spans created in Prefactor backend

---

### Phase 2: P0 Critical Fixes

**Commit**: `2e8b78a` - "fix: Add P0 critical fixes - thinking schema, config fields"

**Issues Fixed** (from `CRITICAL-REVIEW.md`):

1. **Unregistered Span Type** (`pi:agent_thinking`)
   - **Problem**: Schema not registered, backend rejected spans
   - **Fix**: Added schema to `agentSchemaVersion.span_type_schemas`
   - **File**: `src/agent.ts` lines 268-281

2. **Config Schema Mismatch**
   - **Problem**: `getConfigSummary()` referenced non-existent fields
   - **Fix**: Added `captureThinking`, `captureToolInputs`, `captureToolOutputs` to schema
   - **File**: `src/config.ts` lines 41-49

3. **Missing Critical Config Options**
   - **Problem**: No sampling or enable/disable controls
   - **Fix**: Added `samplingRate` (0-1) and `enabled` (boolean)
   - **File**: `src/config.ts` lines 52-57

**New Environment Variables**:
```bash
PREFACTOR_CAPTURE_THINKING=true
PREFACTOR_CAPTURE_TOOL_INPUTS=true
PREFACTOR_CAPTURE_TOOL_OUTPUTS=true
PREFACTOR_SAMPLE_RATE=1.0
PREFACTOR_ENABLED=true
```

---

### Phase 3: Thinking & Tool Span Fixes

**Commit**: `6b8d997` - "fix: Add thinking extraction and fix tool span race condition"

**Issues Fixed**:

4. **Thinking Capture for Text-Based Models**
   - **Problem**: qwen3.5:cloud outputs thinking as formatted text, not structured field
   - **Root Cause**: `event.message.thinking` is `undefined` for this model
   - **Debug Method**: Added `turn_end_debug` logging to inspect event structure
   - **Fix**: Multi-pattern regex extraction from content
   - **File**: `src/index.ts` lines 171-220
   - **Patterns**:
     - `^(Let me (think|work) through[\s\S]*?)(?=\n\n\*\*|## |$)`
     - `^(Let me [\s\S]*?)(?=\n\n\*\*|## Answer|$)`
     - `^(Step \d+:[\s\S]*?)(?=\n\n\*\*|## |Final Answer|$)`

5. **Tool Span Race Condition**
   - **Problem**: Tool results arrived before span creation completed
   - **Root Cause**: Async span creation + concurrent tool execution
   - **Debug Method**: Log correlation showed `tool_result` before `span_created`
   - **Fix**: Pending spans Map to track in-flight creations
   - **Files**: `src/session-state.ts` (interface + 2 methods)
   - **Implementation**:
     - `SessionSpanState.pendingToolSpans: Map<string, Promise<string | null>>`
     - `createToolCallSpan()` tracks promise by toolCallId
     - `closeToolCallSpanWithResult()` waits for pending if needed

**Validated Span Hierarchy**:
```
pi:session (root)
  └─ pi:user_interaction
      ├─ pi:user_message
      └─ pi:agent_run
          ├─ pi:agent_thinking ✅ (extracted from content)
          ├─ pi:tool_call ✅ (reliable, no race condition)
          └─ pi:assistant_response
```

---

## Debugging Methodology

### 1. Multi-Tool Debugging Stack

**Tools Used**:
| Tool | Purpose | Example |
|------|---------|---------|
| **Tmux** | Parallel isolated sessions | `tmux new-session -d -s test-name` |
| **Extension Logging** | Real-time span creation monitoring | `[pi-prefactor:span_created]` |
| **Prefactor CLI** | Backend span verification | `./dist/bin/cli.js agent_spans list` |
| **Git** | Version control, rollback | `git diff`, `git log` |
| **Debug Logs** | Event data inspection | `logger.debug('turn_end_debug', {...})` |

---

### 2. Debugging Workflow

#### Step 1: Enable Debug Logging

```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
source .env
export PREFACTOR_LOG_LEVEL=debug
```

#### Step 2: Run Test with Extension

```bash
# One-shot test
pi -p -e ./src/index.ts "Your test prompt here" 2>&1 | grep "pi-prefactor:"

# Or interactive test in tmux (see below)
```

#### Step 3: Correlate Logs with Backend

**From logs**:
```
[pi-prefactor:span_created] spanId=01kp24vt4d4x99bm9029zh3v01kfebp1 schemaName=pi:agent_thinking
```

**Verify in backend**:
```bash
cd /home/sprite/typescript-sdk/packages/cli
./dist/bin/cli.js agent_spans list --agent_instance_id INSTANCE_ID \
  --start_time START --end_time END | jq '.summaries[] | select(.id == "01kp24vt4d...")'
```

**If span exists**: ✅ Working  
**If span missing**: ❌ Check for API errors, retry queue

---

### 3. Debug Pattern: Add Logging, Inspect, Fix

**Example: Thinking Capture Debug**

**Problem**: No `pi:agent_thinking` spans appearing

**Step 1 - Add Debug Logging**:
```typescript
pi.on("turn_end", async (event, ctx) => {
  logger.debug('turn_end_debug', {
    hasMessage: !!event.message,
    hasThinking: !!(event.message?.thinking),
    thinkingType: typeof event.message?.thinking,
    thinkingPreview: typeof event.message?.thinking === 'string' 
      ? event.message.thinking.slice(0, 100) 
      : 'N/A',
    contentPreview: event.message?.content 
      ? (Array.isArray(event.message.content) ? 'array' : 'other') 
      : 'N/A',
  });
  // ... rest of handler
});
```

**Step 2 - Run Test**:
```bash
pi -p -e ./src/index.ts "Think step by step" 2>&1 | grep turn_end_debug
```

**Step 3 - Analyze Output**:
```
turn_end_debug: hasThinking=false, thinkingType=undefined, contentPreview=array
```

**Conclusion**: Model doesn't output structured thinking, need to extract from content.

**Step 4 - Implement Fix**:
```typescript
// Extract thinking from content using regex patterns
const thinkingPatterns = [...];
for (const pattern of thinkingPatterns) {
  const match = textBlocks.match(pattern);
  if (match) { thinking = match[1]; break; }
}
```

**Step 5 - Validate**:
```bash
pi -p -e ./src/index.ts "Think step by step" 2>&1 | grep thinking_extracted
# Output: [pi-prefactor:thinking_extracted_from_content] thinkingLength=193
```

---

### 4. Common Debug Patterns

#### Pattern A: Race Condition Detection

**Symptom**: `tool_call_span_not_found` warnings

**Debug**:
```bash
pi -p -e ./src/index.ts "Use bash tool" 2>&1 | grep -E "tool_execution_start|tool_result|span_created"
```

**Expected Order**:
```
tool_execution_start → span_created → tool_result → span_closed
```

**Actual Order** (broken):
```
tool_execution_start → tool_result → span_created (too late!)
```

**Fix**: Track pending promises, wait in close handler.

---

#### Pattern B: Missing Span Type

**Symptom**: Spans created locally but not in backend

**Debug**:
```bash
# Check logs
pi -p -e ./src/index.ts "Test" 2>&1 | grep span_created

# Check backend
./dist/bin/cli.js agent_spans list --agent_instance_id ID ... | jq '.summaries[]'
```

**If local but not backend**: Schema not registered

**Fix**: Add to `agentSchemaVersion.span_type_schemas`

---

#### Pattern C: Config Mismatch

**Symptom**: `undefined` values in config summary

**Debug**:
```bash
pi -p -e ./src/index.ts "/prefactor-config" 2>&1 | grep -A20 "config_loaded"
```

**Look for**: `captureThinking: undefined`

**Fix**: Add field to `configSchema` with default value

---

## Tmux Sub-Agent Workflow

### Why Tmux?

**Benefits**:
- **Isolation**: Each task runs in separate session
- **Persistence**: Agents stay running across terminal sessions
- **Parallelism**: Multiple agents working simultaneously
- **Observability**: All agent activity traced via Prefactor extension
- **Safety**: Can kill session without affecting main work

---

### Setup: Worker Agent with Instrumentation

#### Step 1: Create Tmux Session

```bash
tmux new-session -d -s pi-worker-task-name
```

**Naming Convention**: `pi-worker-{task-description}`
- `pi-worker-p0-fixes`
- `pi-worker-turn-spans`
- `pi-worker-tool-schemas`

---

#### Step 2: Launch Pi with Extension

```bash
tmux send-keys -t pi-worker-task-name "cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext && source .env && export PREFACTOR_API_TOKEN PREFACTOR_AGENT_ID PREFACTOR_LOG_LEVEL=info && pi -e ./src/index.ts" Enter
```

**Key Points**:
- `source .env` - Load credentials
- `export PREFACTOR_*` - Pass to pi process
- `pi -e ./src/index.ts` - Load extension from source (dev mode)
- `PREFACTOR_LOG_LEVEL=info` - Production logging (use `debug` for troubleshooting)

---

#### Step 3: Send Task Prompt

```bash
tmux send-keys -t pi-worker-task-name "Your detailed task description here" Enter
```

**Example**:
```bash
tmux send-keys -t pi-worker-task-name "
I need you to implement turn spans for multi-turn agent tracking.

Requirements:
1. Add turn_start hook handler in src/index.ts
2. Add turn span tracking to SessionSpanState in src/session-state.ts
3. Turn spans should be children of agent_run
4. Test with a multi-turn prompt

After completing:
1. Run bun run typecheck
2. Commit with descriptive message
3. Ask me to validate

Start by reading CRITICAL-REVIEW.md section on turn tracking.
" Enter
```

---

#### Step 4: Monitor Progress

**View recent output**:
```bash
tmux capture-pane -t pi-worker-task-name -p -S -50 | tail -30
```

**Watch for Prefactor logs**:
```bash
tmux capture-pane -t pi-worker-task-name -p -S -100 | grep "pi-prefactor:"
```

**Expected logs** (healthy agent):
```
[pi-prefactor:config_loaded] agentId=01knv0ft...
[pi-prefactor:agent_instance_registered] instanceId=01kp...
[pi-prefactor:session_span_created] spanId=01kp...
[pi-prefactor:span_created] schemaName=pi:user_message
[pi-prefactor:span_created] schemaName=pi:agent_run
[pi-prefactor:span_created] schemaName=pi:tool_call
[pi-prefactor:span_created] schemaName=pi:assistant_response
```

---

#### Step 5: Validate Spans in Backend

```bash
# Get latest agent instance
INSTANCE_ID=$(cd /home/sprite/typescript-sdk/packages/cli && \
  ./dist/bin/cli.js agent_instances list --agent_id 01knv0ft674x99bmah4jyj5na21hx9sa \
  | jq -r '.summaries[0].id')

# Query spans
cd /home/sprite/typescript-sdk/packages/cli
./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" \
  --start_time 2026-04-13T00:00:00Z --end_time 2026-04-13T23:59:59Z \
  | jq '.summaries[] | {schema_name, id}'
```

---

#### Step 6: Cleanup

**When task is complete**:
```bash
tmux kill-session -t pi-worker-task-name
```

**Verify cleanup in Prefactor**:
```bash
./dist/bin/cli.js agent_instances list --agent_id 01knv0ft674x99bmah4jyj5na21hx9sa \
  | jq '.summaries[] | select(.started_at > "2026-04-13T00:00:00Z") | {id, status}'
```

Expected: Instance status should be `complete` (not `active`)

---

### Complete Example: P0 Fixes Worker

**Session Creation**:
```bash
# Create session
tmux new-session -d -s pi-worker-p0-fixes

# Launch pi with extension
tmux send-keys -t pi-worker-p0-fixes "cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext && source .env && export PREFACTOR_API_TOKEN PREFACTOR_AGENT_ID && pi -e ./src/index.ts" Enter

# Wait for initialization
sleep 3

# Verify extension loaded
tmux capture-pane -t pi-worker-p0-fixes -p -S -20 | grep "pi-prefactor:extension_initialized"
```

**Expected Output**:
```
[pi-prefactor:extension_initialized] hooks=11 sessionTimeoutHours=24 interactionTimeoutMinutes=5
```

**Send Task**:
```bash
tmux send-keys -t pi-worker-p0-fixes "I've created P0-TASKS.md with 3 critical fixes. Please read it and complete all tasks. Commit when done." Enter
```

**Monitor**:
```bash
# Check progress every 30 seconds
watch -n 30 'tmux capture-pane -t pi-worker-p0-fixes -p -S -10 | tail -5'
```

**Cleanup**:
```bash
tmux kill-session -t pi-worker-p0-fixes
```

---

### Tmux Command Reference

| Command | Description |
|---------|-------------|
| `tmux new-session -d -s name` | Create detached session |
| `tmux attach -t name` | Attach to session |
| `tmux send-keys -t name "cmd" Enter` | Send command |
| `tmux capture-pane -t name -p -S -N` | View last N lines |
| `tmux list-sessions` | List all sessions |
| `tmux kill-session -t name` | Kill session |
| `tmux kill-server` | Kill all sessions |

---

## Instrumentation Best Practices

### Why Always Instrument Worker Agents?

**1. Observability**
- See exactly what the agent is doing in real-time
- Track which hooks fire and in what order
- Debug issues by correlating logs with backend spans

**2. Accountability**
- Every action traced to a span
- Can answer "what did the agent do during this session?"
- Audit trail for debugging and compliance

**3. Performance Monitoring**
- Track agent response times
- Identify slow tool calls
- Monitor token usage per session

**4. Quality Assurance**
- Verify spans are created correctly before deployment
- Catch regressions early (missing spans, wrong hierarchy)
- Test with real Prefactor backend

---

### Instrumentation Checklist

**Before Starting Worker Agent**:

- [ ] Extension loaded: `pi -e ./src/index.ts`
- [ ] Credentials set: `source .env && export PREFACTOR_*`
- [ ] Log level appropriate: `PREFACTOR_LOG_LEVEL=info` (or `debug` for troubleshooting)
- [ ] Tmux session named: `pi-worker-{task}`
- [ ] Session monitored: Check for `extension_initialized` log

**During Work**:

- [ ] Spans appearing in logs: `grep "pi-prefactor:span_created"`
- [ ] No errors: `grep "pi-prefactor:error"`
- [ ] Tool spans created before results: No `tool_call_span_not_found` warnings
- [ ] Thinking captured (if applicable): `grep "thinking_span_created"`

**After Completion**:

- [ ] Session spans closed: `grep "session_span_closed"`
- [ ] Instance finished: Check Prefactor CLI for `status: complete`
- [ ] Spans validated: Query backend, verify hierarchy correct
- [ ] Tmux session killed: `tmux kill-session -t name`

---

### Example: Instrumented Development Session

```bash
#!/bin/bash
# dev-session.sh - Create instrumented development environment

set -e

SESSION_NAME="pi-worker-$(date +%Y%m%d-%H%M%S)"
EXTENSION_DIR="/home/sprite/typescript-sdk/packages/pi-prefactor-ext"
CLI_DIR="/home/sprite/typescript-sdk/packages/cli"

echo "Creating instrumented dev session: $SESSION_NAME"

# Create session
tmux new-session -d -s "$SESSION_NAME"

# Launch pi with extension
tmux send-keys -t "$SESSION_NAME" "
cd $EXTENSION_DIR
source .env
export PREFACTOR_API_TOKEN PREFACTOR_AGENT_ID PREFACTOR_LOG_LEVEL=info
echo 'Loading pi with prefactor extension...'
pi -e ./src/index.ts
" Enter

# Wait for initialization
sleep 5

# Verify extension loaded
if tmux capture-pane -t "$SESSION_NAME" -p -S -20 | grep -q "extension_initialized"; then
  echo "✅ Extension loaded successfully"
  
  # Get instance ID for later validation
  INSTANCE_ID=$(tmux capture-pane -t "$SESSION_NAME" -p -S -20 | \
    grep "agent_instance_registered" | \
    grep -o 'instanceId=[^ ]*' | cut -d= -f2)
  
  echo "Instance ID: $INSTANCE_ID"
  echo "Session ready. Attach with: tmux attach -t $SESSION_NAME"
  echo "Validate spans with: $CLI_DIR/dist/bin/cli.js agent_spans list --agent_instance_id $INSTANCE_ID ..."
else
  echo "❌ Extension failed to load"
  tmux kill-session -t "$SESSION_NAME"
  exit 1
fi
```

---

## Proposed Future Fixes

### P1 High Priority (Next Sprint)

#### 1. Turn Spans for Multi-Turn Tracking

**Problem**: Multi-turn agent runs (LLM → tools → LLM → tools) not tracked individually.

**Impact**: Cannot debug why agent took multiple iterations.

**Implementation Plan**:
```typescript
// In session-state.ts
interface SessionSpanState {
  currentTurnIndex: number;
  turnSpanIds: Map<number, string>;
}

async createTurnSpan(sessionKey, turnIndex, payload) {
  const spanId = await this.agent.createSpan(
    sessionKey, 'pi:turn', payload, state.agentRunSpanId
  );
  state.turnSpanIds.set(turnIndex, spanId);
}

// In index.ts
pi.on("turn_start", async (event, ctx) => {
  await sessionManager.createTurnSpan(sessionKey, event.turnIndex, {
    turnIndex: event.turnIndex,
  });
});

pi.on("turn_end", async (event, ctx) => {
  await sessionManager.closeTurnSpan(sessionKey, event.turnIndex);
});
```

**Effort**: ~2 hours  
**Priority**: High  
**Files**: `src/session-state.ts`, `src/index.ts`

---

#### 2. Tool-Specific Schemas

**Problem**: All tools use generic `pi:tool_call` schema.

**Impact**: Prefactor can't validate tool-specific payloads or provide tool-specific UI.

**Implementation Plan**:
```typescript
// In agent.ts agentSchemaVersion
span_type_schemas: [
  {
    name: 'pi:tool:bash',
    params_schema: {
      command: { type: 'string' },
      timeout: { type: 'number' },
      exitCode: { type: 'number' },
      stdout: { type: 'string' },
      stderr: { type: 'string' },
    },
  },
  {
    name: 'pi:tool:read',
    params_schema: {
      path: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      contentLength: { type: 'number' },
    },
  },
  // ... write, edit schemas
]
```

**Effort**: ~3 hours  
**Priority**: High  
**Files**: `src/agent.ts`, `src/tool-definitions.ts` (new)

---

#### 3. Circuit Breaker for API Failures

**Problem**: Silent span creation failures, no backpressure on API issues.

**Impact**: Data loss during API outages, no visibility into failures.

**Implementation Plan**:
```typescript
// In agent.ts
private consecutiveFailures = 0;
private circuitOpen = false;

async createSpan(...) {
  if (this.circuitOpen) {
    this.logger.warn('circuit_open', { sessionKey, schemaName });
    return null;
  }
  
  try {
    const spanId = await this.doCreateSpan(...);
    this.consecutiveFailures = 0;
    return spanId;
  } catch (err) {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 5) {
      this.circuitOpen = true;
      this.logger.error('circuit_breaker_opened', { failures: this.consecutiveFailures });
    }
    throw err;
  }
}
```

**Effort**: ~1 hour  
**Priority**: High  
**Files**: `src/agent.ts`

---

#### 4. Secret Redaction for Tool Inputs

**Problem**: Tool inputs may contain secrets (API keys, passwords) captured as-is.

**Impact**: Security risk, credentials stored in Prefactor backend.

**Implementation Plan**:
```typescript
function redactSecrets(input: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...input };
  const secretPatterns = [
    /Bearer\s+[a-zA-Z0-9\-_]+/gi,
    /api[_-]?key[=:]\s*[a-zA-Z0-9\-_]+/gi,
    /password[=:]\s*[^\s]+/gi,
  ];
  
  for (const [key, value] of Object.entries(redacted)) {
    if (typeof value === 'string') {
      let redactedValue = value;
      for (const pattern of secretPatterns) {
        redactedValue = redactedValue.replace(pattern, '[REDACTED]');
      }
      redacted[key] = redactedValue;
    }
  }
  
  return redacted;
}

// In tool_execution_start handler
if (config.captureToolInputs) {
  payload.input = redactSecrets(event.args);
}
```

**Effort**: ~1 hour  
**Priority**: High  
**Files**: `src/index.ts`, `src/redaction.ts` (new)

---

### P2 Medium Priority (Future)

#### 5. Session-Level Analytics

**Idea**: Aggregate metrics at session level for productivity insights.

**Data to Track**:
- User message count
- Agent run count
- Tool call breakdown (by tool name)
- Token usage totals
- Session duration
- Files modified

**Effort**: ~4 hours

---

#### 6. before_provider_request Hook

**Idea**: Capture exact LLM request payloads for debugging.

**Use Case**: Debug "why did agent forget context?" by seeing exact messages sent.

**Effort**: ~30 minutes

---

#### 7. Health Check Command

**Idea**: `/prefactor-status` command to show runtime status.

**Output**:
- API connectivity status
- Retry queue depth
- Active session count
- Recent span creation success rate

**Effort**: ~1 hour

---

### P3 Low Priority (Nice to Have)

#### 8. Automated Tests

**Idea**: Unit and integration tests for CI/CD.

**Test Files**:
- `tests/config.test.ts`
- `tests/session-state.test.ts`
- `tests/tool-definitions.test.ts`
- `tests/integration.test.ts` (requires credentials)

**Effort**: ~4 hours

---

#### 9. Rate Limiting

**Idea**: Prevent API overload from high-frequency tool calls.

**Implementation**: Token bucket rate limiter (10 tokens/sec)

**Effort**: ~1 hour

---

#### 10. Payload Compression

**Idea**: Compress large thinking blocks or tool outputs.

**Threshold**: Compress if payload > 10KB

**Effort**: ~1 hour

---

## Quick Reference

### Environment Variables

```bash
# Required
export PREFACTOR_API_TOKEN='your-token'
export PREFACTOR_AGENT_ID='your-agent-id'

# Optional (with defaults)
export PREFACTOR_API_URL='https://app.prefactorai.com'  # default
export PREFACTOR_AGENT_NAME='Pi Agent'  # default
export PREFACTOR_LOG_LEVEL='info'  # debug|info|warn|error
export PREFACTOR_CAPTURE_THINKING='true'  # default
export PREFACTOR_CAPTURE_TOOL_INPUTS='true'  # default
export PREFACTOR_CAPTURE_TOOL_OUTPUTS='true'  # default
export PREFACTOR_SAMPLE_RATE='1.0'  # 0.0-1.0
export PREFACTOR_ENABLED='true'  # default
```

---

### Test Commands

```bash
# One-shot test with extension
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
source .env
export PREFACTOR_LOG_LEVEL=debug
pi -p -e ./src/index.ts "Your test prompt"

# Test thinking capture
pi -p -e ./src/index.ts "What is 2+2? Think step by step." 2>&1 | grep thinking

# Test tool spans
pi -p -e ./src/index.ts "List files using bash" 2>&1 | grep tool_call_span

# Verify in Prefactor
cd /home/sprite/typescript-sdk/packages/cli
./dist/bin/cli.js agent_instances list --agent_id 01knv0ft674x99bmah4jyj5na21hx9sa
./dist/bin/cli.js agent_spans list --agent_instance_id INSTANCE_ID --start_time START --end_time END
```

---

### Tmux Quick Commands

```bash
# Create worker session
tmux new-session -d -s pi-worker-task

# Launch pi with extension
tmux send-keys -t pi-worker-task "cd /path/to/ext && source .env && pi -e ./src/index.ts" Enter

# Monitor
tmux capture-pane -t pi-worker-task -p -S -50 | tail -20

# Kill when done
tmux kill-session -t pi-worker-task
```

---

### Span Hierarchy (Current)

```
pi:session (root, 24hr)
  └─ pi:user_interaction (5min idle timeout)
      ├─ pi:user_message (user input)
      └─ pi:agent_run (agent execution)
          ├─ pi:agent_thinking (reasoning, extracted from content)
          ├─ pi:tool_call (tool executions)
          └─ pi:assistant_response (LLM response)
```

---

### Files Reference

| File | Purpose | Lines |
|------|---------|-------|
| `src/index.ts` | Extension entry, hook handlers | ~280 |
| `src/agent.ts` | HTTP client, span schemas | ~450 |
| `src/session-state.ts` | Span hierarchy management | ~320 |
| `src/config.ts` | Configuration schema, loading | ~200 |
| `src/logger.ts` | Structured logging | ~80 |

---

## References

- `CRITICAL-REVIEW.md` - Comprehensive critical analysis
- `P0-FIXES-COMPLETE.md` - P0 fixes summary
- `THINKING-AND-TOOL-FIXES-COMPLETE.md` - Latest fixes validation
- `THINKING-INVESTIGATION.md` - Root cause analysis
- `DEBUGGING-AND-VALIDATION-GUIDE.md` - Testing approach
- `PLAN-v2.md` - Original implementation plan
- `MVP-GAPS.md` - Gap analysis

---

## Contact

For questions about this development process, refer to the references above or consult the development team.

**Last Updated**: 2026-04-13  
**Version**: 0.0.1-mvp
