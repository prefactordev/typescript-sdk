# AGENTS.md: Development Guide for Coding Agents

**Version**: 1.0  
**Date**: 2026-04-13  
**Audience**: AI coding agents developing this extension  

---

## Overview

This extension instruments the Pi coding agent to capture session data and submit it to the Prefactor observability system. Your task when working on this codebase is to ensure all agent actions are captured accurately while maintaining clean, meaningful data payloads.

---

## Quick Start

### 1. Load Environment Variables

```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
source .env
export PREFACTOR_API_TOKEN PREFACTOR_AGENT_ID PREFACTOR_LOG_LEVEL=warn
```

### 2. Build the Extension

```bash
cd /home/sprite/typescript-sdk
bun run build
```

### 3. Test with Pi

```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
timeout 30 pi -p -e ./src/index.ts "Your test command here"
```

---

## ⚠️ CRITICAL: Always Use Timeouts

### NEVER Run Pi Without Timeout

Pi agent can hang indefinitely. **Always** wrap pi commands with timeout:

```bash
# ❌ WRONG - Can hang forever
pi -p -e ./src/index.ts "do something"

# ✅ CORRECT - Times out after 30 seconds
timeout 30 pi -p -e ./src/index.ts "do something"
```

### Recommended Timeout Values

| Task | Timeout |
|------|---------|
| Simple file operations | 30 seconds |
| Bash commands | 30 seconds |
| Multi-file edits | 45 seconds |
| Complex tasks | 60 seconds |
| Testing/development | 30 seconds |

### Why This Matters

- Pi can enter infinite loops waiting for user input
- Network issues can cause hangs
- Agent can get stuck in tool execution
- **Without timeout, your tmux session will block forever**

---

## Spawning Test Agents in tmux

### Why Use tmux?

- Run multiple test sessions in parallel
- Isolate test runs from your main session
- Easy to monitor multiple agents simultaneously
- Can detach and check results later

### Spawn a Single Test Agent

```bash
tmux new-session -d -s test-agent-1 "cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext && source .env && export PREFACTOR_API_TOKEN PREFACTOR_AGENT_ID PREFACTOR_LOG_LEVEL=warn && pi -e ./src/index.ts"
```

### Send Commands to Test Agent

```bash
tmux send-keys -t test-agent-1 "timeout 30 pi -p -e ./src/index.ts \"Create a test file\" 2>&1" Enter
```

### Monitor Test Agent

```bash
# View last 40 lines
tmux capture-pane -t test-agent-1 -p -S -40 | tail -20

# Attach to session (interactive)
tmux attach-session -t test-agent-1

# Detach from session
# Press Ctrl+b, then d
```

### Spawn Multiple Test Agents

```bash
# Spawn 3 test agents
tmux new-session -d -s test-agent-1 "cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext && source .env && export PREFACTOR_API_TOKEN PREFACTOR_AGENT_ID PREFACTOR_LOG_LEVEL=warn && pi -e ./src/index.ts"

tmux new-session -d -s test-agent-2 "cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext && source .env && export PREFACTOR_API_TOKEN PREFACTOR_AGENT_ID PREFACTOR_LOG_LEVEL=warn && pi -e ./src/index.ts"

tmux new-session -d -s test-agent-3 "cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext && source .env && export PREFACTOR_API_TOKEN PREFACTOR_AGENT_ID PREFACTOR_LOG_LEVEL=warn && pi -e ./src/index.ts"

# Send different commands to each
tmux send-keys -t test-agent-1 "timeout 30 pi -p -e ./src/index.ts \"Create file1.txt\" 2>&1" Enter
tmux send-keys -t test-agent-2 "timeout 30 pi -p -e ./src/index.ts \"Run ls -la\" 2>&1" Enter
tmux send-keys -t test-agent-3 "timeout 30 pi -p -e ./src/index.ts \"Read README.md\" 2>&1" Enter
```

### List All Test Sessions

```bash
tmux list-sessions | grep test-agent
```

### Kill Test Sessions

```bash
# Kill specific session
tmux kill-session -t test-agent-1

# Kill all test sessions
tmux list-sessions | grep test-agent | cut -d: -f1 | xargs -I {} tmux kill-session -t {}
```

---

## Debugging with Prefactor CLI

### Build CLI First

```bash
cd /home/sprite/typescript-sdk
bun run build
```

### Source Environment

```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
source .env
export PREFACTOR_API_TOKEN PREFACTOR_AGENT_ID
```

### Query Agents

```bash
# List all agents
cd /home/sprite/typescript-sdk/packages/cli
bun ./dist/bin/cli.js agents list 2>&1 | jq '.'
```

### Query Agent Instances

```bash
# List all instances for your agent
bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID 2>&1 | jq '.'

# List recent instances (last 5)
bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID 2>&1 | jq '.summaries[:5] | .[] | {id, status, started_at}'

# List only completed instances
bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID 2>&1 | jq '.summaries[] | select(.status == "complete") | {id, started_at, finished_at}'
```

### Query Spans for an Instance

```bash
# Get instance ID
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID 2>&1 | jq -r '.summaries[0].id')

# List all spans for instance
START="2026-04-13T00:00:00Z"
END="2026-04-13T23:59:59Z"

bun ./dist/bin/cli.js agent_spans list \
  --agent_instance_id "$INSTANCE_ID" \
  --start_time "$START" \
  --end_time "$END" \
  2>&1 | jq '.'
```

### Inspect Specific Span Types

```bash
# Get agent_run span
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:agent_run") | {payload, result_payload}'

# Get all tool spans
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.schema_name | startswith("pi:tool:")) | {schema_name, payload: (.payload | {path, command}), result_payload: (.result_payload | {isError, exitCode})}'

# Get assistant_response span
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:assistant_response") | {payload, result_payload}'
```

### Validate Span Hierarchy

```bash
# Check parent-child relationships
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries | map({schema: .schema_name, parent: .parent_span_id != null, status: .status})'

# Expected hierarchy:
# pi:session (no parent)
#   └─ pi:user_message (has parent)
#       └─ pi:agent_run (no parent or has parent)
#           ├─ pi:tool:* (has parent)
#           └─ pi:assistant_response (has parent)
```

### Check for Missing Data

```bash
# Check if userRequest is captured
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.userRequest'

# Check if filesModified is captured
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.filesModified'

# Check if duration is tracked
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.durationMs'

# Check for noise fields (should NOT be present)
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload | {has_messageCount: (.messageCount != null), has_startTime: (.startTime != null), has_provider: (.provider != null)}'
```

### Count Span Types

```bash
# Group spans by type
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries | group_by(.schema_name) | .[] | {schema: .[0].schema_name, count: length}'

# Expected output:
# { "schema": "pi:session", "count": 1 }
# { "schema": "pi:user_message", "count": 1 }
# { "schema": "pi:agent_run", "count": 1 }
# { "schema": "pi:tool:write", "count": 1 }
# { "schema": "pi:assistant_response", "count": 1 }
```

### Check for Orphaned Spans

```bash
# Find spans with status "active" (should be "complete" after session ends)
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.status == "active") | {schema_name, status, started_at}'

# All spans should be "complete" after session finishes
```

---

## Prefactor CLI Validation Commands

### Complete Validation Workflow

```bash
# 1. Build everything
cd /home/sprite/typescript-sdk
bun run build

# 2. Run a test session
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
timeout 30 pi -p -e ./src/index.ts "Create test.txt with hello"

# 3. Get latest instance ID
INSTANCE_ID=$(bun ../cli/dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID 2>&1 | jq -r '.summaries[0].id')

# 4. Validate span count (should be > 0)
SPAN_COUNT=$(bun ../cli/dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" \
  --start_time "2026-04-13T00:00:00Z" --end_time "2026-04-13T23:59:59Z" 2>&1 | \
  jq '.summaries | length')

echo "Span count: $SPAN_COUNT"

# 5. Validate all spans are complete
ACTIVE_COUNT=$(bun ../cli/dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" \
  --start_time "2026-04-13T00:00:00Z" --end_time "2026-04-13T23:59:59Z" 2>&1 | \
  jq '[.summaries[] | select(.status == "active")] | length')

echo "Active spans: $ACTIVE_COUNT (should be 0)"

# 6. Validate agent_run has userRequest
USER_REQUEST=$(bun ../cli/dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" \
  --start_time "2026-04-13T00:00:00Z" --end_time "2026-04-13T23:59:59Z" 2>&1 | \
  jq -r '.summaries[] | select(.schema_name == "pi:agent_run") | .payload.userRequest')

echo "User request: $USER_REQUEST"

# 7. Validate filesModified is captured
FILES_MODIFIED=$(bun ../cli/dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" \
  --start_time "2026-04-13T00:00:00Z" --end_time "2026-04-13T23:59:59Z" 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.filesModified')

echo "Files modified: $FILES_MODIFIED"
```

### Quick Validation Function

Add this to your `.bashrc` or `.zshrc`:

```bash
validate-prefactor() {
  cd /home/sprite/typescript-sdk
  bun run build
  
  cd packages/pi-prefactor-ext
  timeout 30 pi -p -e ./src/index.ts "$1"
  
  INSTANCE_ID=$(bun ../cli/dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID 2>&1 | jq -r '.summaries[0].id')
  
  echo "=== Validation Results ==="
  echo "Instance ID: $INSTANCE_ID"
  echo "Span count: $(bun ../cli/dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" --start_time "2026-04-13T00:00:00Z" --end_time "2026-04-13T23:59:59Z" 2>&1 | jq '.summaries | length')"
  echo "Active spans: $(bun ../cli/dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" --start_time "2026-04-13T00:00:00Z" --end_time "2026-04-13T23:59:59Z" 2>&1 | jq '[.summaries[] | select(.status == "active")] | length')"
}
```

---

## Common Debugging Scenarios

### Scenario 1: Verify Span Was Created

```bash
# 1. Run a test
timeout 30 pi -p -e ./src/index.ts "Create test.txt"

# 2. Get latest instance
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID 2>&1 | jq -r '.summaries[0].id')

# 3. Check spans
bun ./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" \
  --start_time "2026-04-13T00:00:00Z" --end_time "2026-04-13T23:59:59Z" 2>&1 | \
  jq '.summaries | length'

# Should return > 0 if spans were created
```

---

### Scenario 2: Verify Payload Contains Expected Data

```bash
# Check agent_run payload
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:agent_run") | .payload | keys'

# Expected: ["model", "userRequest", "systemPrompt", "skillsLoaded", "toolsAvailable"]
# NOT expected: ["messageCount", "startTime", "provider"]
```

---

### Scenario 3: Verify Span Hierarchy

```bash
# Get all spans with their parent info
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries | map({schema: .schema_name, hasParent: (.parent_span_id != null)})'

# Verify assistant_response is child of agent_run
# Verify tool spans are children of agent_run
```

---

### Scenario 4: Check for Span Closure Issues

```bash
# All spans should be "complete" after session ends
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries | group_by(.status) | .[] | {status: .[0].status, count: length}'

# Expected: { "status": "complete", "count": N }
# If you see "active" spans, there's a closure bug
```

---

### Scenario 5: Verify No Contradictory Data

```bash
# Check success vs terminationReason consistency
bun ./dist/bin/cli.js agent_spans list ... 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload | {success, terminationReason}'

# Should NOT see: { "success": true, "terminationReason": "error" }
# Should see: { "success": true, "terminationReason": "completed" } or "session_shutdown"
```

---

## Development Workflow

### 1. Make Changes

```bash
# Edit source files
edit src/index.ts
edit src/agent.ts
edit src/session-state.ts
```

### 2. Build

```bash
cd /home/sprite/typescript-sdk
bun run build
```

### 3. Test with Timeout

```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
timeout 30 pi -p -e ./src/index.ts "Test your change"
```

### 4. Verify in Prefactor

```bash
cd /home/sprite/typescript-sdk/packages/cli
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID 2>&1 | jq -r '.summaries[0].id')
bun ./dist/bin/cli.js agent_spans list --agent_instance_id "$INSTANCE_ID" \
  --start_time "2026-04-13T00:00:00Z" --end_time "2026-04-13T23:59:59Z" 2>&1 | \
  jq '.summaries[] | select(.schema_name == "pi:agent_run")'
```

### 5. Iterate

```bash
# If test failed, check logs, fix code, rebuild, retest
# Always use timeout!
```

---

## Code Quality Guidelines

### 1. Every Field Must Earn Its Place

```typescript
// ❌ WRONG - Fixed value provides no signal
messageCount: 1,  // Always 1 in pi sessions

// ✅ RIGHT - Only include fields that vary and answer questions
userRequest: "...",  // Varies per session
model: "...",        // Can vary if configured
```

### 2. No Redundant Fields

```typescript
// ❌ WRONG - Redundant with span metadata
startTime: Date.now(),  // Backend tracks started_at
endTime: Date.now(),    // Backend tracks finished_at

// ✅ RIGHT - Track locally for duration, don't send to backend
const startTime = Date.now();
// ... do work ...
const durationMs = Date.now() - startTime;
await finishSpan({ durationMs });  // Send duration, not timestamps
```

### 3. Capture Errors Gracefully

```typescript
// ✅ RIGHT - Capture error info but don't crash
try {
  await createSpan(...);
} catch (error) {
  logger.error('span_creation_failed', { error });
  // Continue - don't let instrumentation break user workflow
}
```

### 4. Use Consistent Naming

```typescript
// ✅ RIGHT - Consistent schema names
'pi:session'
'pi:user_message'
'pi:agent_run'
'pi:tool:bash'
'pi:tool:read'
'pi:tool:write'
'pi:tool:edit'
'pi:assistant_response'

// ❌ WRONG - Inconsistent
'pi:tool_call'  // Too generic
'pi:turn'       // Removed (low value)
```

---

## Testing Checklist

Before committing changes, verify:

- [ ] Build passes: `bun run build`
- [ ] TypeScript compiles without errors
- [ ] Test session completes with timeout
- [ ] Spans appear in Prefactor
- [ ] Payload contains expected fields
- [ ] No noise fields present (messageCount, startTime, provider)
- [ ] Span hierarchy is correct
- [ ] All spans close properly (status: "complete")
- [ ] No contradictory data (success vs terminationReason)
- [ ] Duration is tracked
- [ ] Files modified are captured
- [ ] Assistant response is captured

---

## Common Pitfalls

### ❌ Pitfall 1: Forgetting Timeout

```bash
# WRONG - Can hang forever
pi -p -e ./src/index.ts "test"

# RIGHT - Always use timeout
timeout 30 pi -p -e ./src/index.ts "test"
```

---

### ❌ Pitfall 2: Not Rebuilding

```bash
# WRONG - Testing old code
edit src/index.ts
pi -p -e ./src/index.ts "test"  # Uses old compiled code!

# RIGHT - Rebuild first
edit src/index.ts
bun run build
pi -p -e ./src/index.ts "test"
```

---

### ❌ Pitfall 3: Not Checking Prefactor

```bash
# WRONG - Assuming it works
pi -p -e ./src/index.ts "test"
# (don't verify spans)

# RIGHT - Always verify
pi -p -e ./src/index.ts "test"
INSTANCE_ID=$(...)
bun ./dist/bin/cli.js agent_spans list ... | jq '.'
```

---

### ❌ Pitfall 4: Adding Noise Fields

```typescript
// WRONG - Adding fields that provide no signal
await createSpan('pi:agent_run', {
  messageCount: 1,  // Always 1!
  provider: 'ollama',  // Redundant with model
  startTime: Date.now(),  // Redundant with span metadata
});

// RIGHT - Only meaningful fields
await createSpan('pi:agent_run', {
  model: ctx.model?.id,
  userRequest: state?.userRequest,
});
```

---

### ❌ Pitfall 5: Not Handling Missing Data

```typescript
// WRONG - Assumes data always available
const tokens = event.usage.input_tokens;  // Can be undefined!

// RIGHT - Handle missing data gracefully
const tokens = event.usage?.input_tokens 
  ? { input: event.usage.input_tokens, ... }
  : undefined;
```

---

## Environment Variables

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `PREFACTOR_API_TOKEN` | Prefactor API authentication | Yes | - |
| `PREFACTOR_AGENT_ID` | Agent identifier in Prefactor | Yes | - |
| `PREFACTOR_API_URL` | Prefactor API endpoint | No | `https://app.prefactorai.com` |
| `PREFACTOR_LOG_LEVEL` | Extension log level | No | `warn` |
| `PREFACTOR_CAPTURE_INPUTS` | Capture tool inputs | No | `true` |
| `PREFACTOR_CAPTURE_OUTPUTS` | Capture tool outputs | No | `true` |
| `PREFACTOR_MAX_OUTPUT_LENGTH` | Max output length to capture | No | `10000` |
| `PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES` | Interaction timeout | No | `5` |
| `PREFACTOR_SESSION_TIMEOUT_HOURS` | Session timeout | No | `24` |

---

## File Structure

```
packages/pi-prefactor-ext/
├── src/
│   ├── index.ts           # Main extension entry point
│   ├── agent.ts           # Prefactor API client, span schemas
│   ├── session-state.ts   # Session state tracking
│   ├── config.ts          # Configuration schema
│   └── logger.ts          # Logging utilities
├── .env                   # Environment variables (DO NOT COMMIT)
├── package.json           # Package configuration
├── OVERVIEW.md            # Business overview
├── AGENTS.md              # This file
└── README.md              # User quick start
```

---

## Key Files to Modify

| Task | File to Modify |
|------|----------------|
| Add new span type | `src/agent.ts` (schema registration) |
| Capture new data | `src/index.ts` (hook handlers) |
| Track new state | `src/session-state.ts` (state interface) |
| Add config option | `src/config.ts` (schema and defaults) |
| Change logging | `src/logger.ts` (log levels) |

---

## Support and Resources

### Documentation

- [OVERVIEW.md](./OVERVIEW.md) - Business purpose and requirements
- [README.md](./README.md) - Quick start guide
- [DEVELOPMENT-GUIDE.md](./DEVELOPMENT-GUIDE.md) - Detailed development instructions
- [DEBUGGING-AND-VALIDATION-GUIDE.md](./DEBUGGING-AND-VALIDATION-GUIDE.md) - Validation procedures

### Prefactor CLI Commands

```bash
# Help
bun ./dist/bin/cli.js --help

# Agent instances
bun ./dist/bin/cli.js agent_instances --help

# Agent spans
bun ./dist/bin/cli.js agent_spans --help
```

### Common jq Patterns

```bash
# Get first instance ID
jq -r '.summaries[0].id'

# Filter by status
jq '.summaries[] | select(.status == "complete")'

# Extract specific field
jq '.summaries[] | .payload.userRequest'

# Count items
jq '.summaries | length'

# Group by field
jq '.summaries | group_by(.schema_name)'
```

---

## Summary

**Golden Rules**:

1. ✅ **Always use timeout** - `timeout 30 pi ...`
2. ✅ **Always rebuild** - `bun run build` before testing
3. ✅ **Always verify** - Check Prefactor CLI after tests
4. ✅ **No noise fields** - Every field must earn its place
5. ✅ **Clean hierarchy** - Proper parent-child relationships
6. ✅ **Close all spans** - No "active" spans after session ends
