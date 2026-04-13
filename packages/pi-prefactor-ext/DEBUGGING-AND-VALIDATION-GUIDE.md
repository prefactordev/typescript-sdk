# Debugging and Validation Guide

**Pi-Prefactor Extension Development**  
**Date**: 2026-04-13  
**Status**: MVP Complete and Validated

---

## Overview

This document captures the debugging approach and validation tools used during development of the pi-prefactor extension. Use this as a reference for troubleshooting and validating future instrumentation work.

---

## Tools Used

### 1. Tmux Sessions (Parallel Testing)

**Purpose**: Run multiple isolated testing environments simultaneously

**Sessions Created**:
```bash
# CLI testing - Query Prefactor API
tmux new-session -d -s prefactor-cli-test

# MVP continuation - Documentation and implementation
tmux new-session -d -s mvp-continuation

# Pi validation - Run pi with extension
tmux new-session -d -s pi-validation-test
```

**Management Commands**:
```bash
# List all sessions
tmux list-sessions

# Attach to session
tmux attach -t session-name

# Detach (keep running)
# Ctrl+B, then D

# View recent output (without attaching)
tmux capture-pane -t session-name -p | tail -50

# Send commands to session
tmux send-keys -t session-name "your-command" Enter

# Kill session
tmux kill-session -t session-name

# Kill all sessions
tmux kill-server
```

**Why Tmux**: 
- Keeps pi processes running in background
- Can monitor multiple test scenarios simultaneously
- Preserves session state for debugging
- Can attach/detach without losing work

---

### 2. Prefactor CLI (Backend Verification)

**Purpose**: Query Prefactor API to verify spans are being created correctly

**Location**: `/home/sprite/typescript-sdk/packages/cli`

**Setup**:
```bash
cd /home/sprite/typescript-sdk/packages/cli

# Add profile with API credentials
./dist/bin/cli.js profiles add default \
  --api-token 'eyJhbGci...'

# Verify profile added
./dist/bin/cli.js profiles list
```

**Key Commands**:

#### List Agents
```bash
./dist/bin/cli.js agents list --environment_id YOUR_ENV_ID
```

**Output**:
```json
{
  "id": "01knv0ft674x99bmah4jyj5na21hx9sa",
  "name": "Pi Agent",
  "status": "active",
  "description": "Pi Agent — Pi 0.66.0 with Prefactor Plugin 0.0.1-mvp"
}
```

#### List Agent Instances
```bash
./dist/bin/cli.js agent_instances list \
  --agent_id 01knv0ft674x99bmah4jyj5na21hx9sa
```

**Output**:
```json
{
  "id": "01kp236rp84x99bmk02bprfb6vknpj9j",
  "status": "active",
  "started_at": "2026-04-13T00:17:33Z",
  "agent_id": "01knv0ft674x99bmah4jyj5na21hx9sa"
}
```

#### List Spans for Instance
```bash
./dist/bin/cli.js agent_spans list \
  --agent_instance_id 01kp236rp84x99bmk02bprfb6vknpj9j \
  --start_time 2026-04-13T00:17:00Z \
  --end_time 2026-04-13T00:19:00Z
```

**Output**:
```json
{
  "schema_name": "pi:user_message",
  "parent_span_id": "01kp2378ct4x99bmcy4n6f9qhkmxmwxx",
  "payload": {
    "text": "What files are in this directory?",
    "timestamp": "2026-04-13 00:17:48.872000000"
  }
}
```

**Why CLI**:
- Direct API access without UI
- Can filter by time range
- Shows raw span data (schema_name, parent_span_id, payload)
- Verifies backend received spans correctly

---

### 3. Extension Logging (Real-time Monitoring)

**Purpose**: Watch span creation in real-time as pi interacts with extension

**Log Format**:
```
[timestamp] [pi-prefactor:event] key=value pairs
```

**Example Logs**:
```
[2026-04-13T00:17:32.534Z] [pi-prefactor:config_loaded] apiUrl=https://app.prefactorai.com agentId=01knv0ft...
[2026-04-13T00:17:32.536Z] [pi-prefactor:agent_init] agentVersion=pi-0.66.0-plugin-0.0.1-mvp-default
[2026-04-13T00:17:33.507Z] [pi-prefactor:agent_instance_registered] instanceId=01kp236rp84x99bmk02bprfb6vknpj9j
[2026-04-13T00:17:34.067Z] [pi-prefactor:session_span_created] spanId=01kp2378ct4x99bmcy4n6f9qhkmxmwxx
[2026-04-13T00:17:48.872Z] [pi-prefactor:input] sessionKey=/home/sprite/.pi/agent/sessions/...
[2026-04-13T00:17:49.614Z] [pi-prefactor:interaction_span_created] spanId=01kp2378tm4x99bm3rpgr2pgdkr9pfew
[2026-04-13T00:17:50.094Z] [pi-prefactor:user_message_span_created] spanId=...
[2026-04-13T00:17:50.520Z] [pi-prefactor:agent_run_span_created] spanId=...
[2026-04-13T00:18:03.537Z] [pi-prefactor:tool_execution_start] toolName=bash
[2026-04-13T00:18:04.050Z] [pi-prefactor:tool_call_span_created] spanId=...
[2026-04-13T00:18:11.176Z] [pi-prefactor:assistant_response_span_created] spanId=...
```

**Key Log Events to Monitor**:

| Event | What It Means |
|-------|---------------|
| `config_loaded` | Extension loaded configuration |
| `agent_init` | Prefactor HTTP client initialized |
| `agent_instance_registered` | Agent registered with backend |
| `session_span_created` | Root session span created |
| `interaction_span_created` | User interaction span created |
| `user_message_span_created` | User message captured |
| `agent_run_span_created` | Agent execution started |
| `tool_execution_start` | Tool call detected |
| `tool_call_span_created` | Tool span created |
| `assistant_response_span_created` | LLM response captured |
| `agent_run_span_closed` | Agent execution finished |

**How to View Logs**:
```bash
# In tmux session with pi running
tmux capture-pane -t pi-validation-test -p -S -300 | grep "pi-prefactor:"

# Or watch in real-time (if logging to file)
tail -f /tmp/pi-prefactor.log | grep "pi-prefactor:"
```

**Why Logging**:
- Real-time feedback on span creation
- Identifies which hooks are firing
- Shows span IDs for correlation with CLI queries
- Catches errors immediately (e.g., `tool_call_span_not_found`)

---

### 4. Git (Version Control & Tracking)

**Purpose**: Track changes, rollback if needed, maintain clean commits

**Commands Used**:
```bash
# Check status
git status

# View changes
git diff

# Commit with descriptive message
git add -A
git commit -m "feat: Add thinking block capture"

# Push to branch
git push

# View commit history
git log --oneline
```

**Branch Strategy**:
```
main
  └─ feature/pi-prefactor-extension (development branch)
      ├─ Initial docs and test harness
      ├─ MVP implementation (11 hooks)
      ├─ Gap analysis documentation
      ├─ Thinking capture implementation
      └─ Make thinking capture always-on
```

**Why Git**:
- Track incremental progress
- Easy rollback if something breaks
- Clear commit history for review
- Branch isolation from main development

---

## Debugging Workflow

### Step 1: Start Pi with Extension

```bash
tmux new-session -d -s pi-test
tmux send-keys -t pi-test "cd /path/to/pi-prefactor-ext"
tmux send-keys -t pi-test "export PREFACTOR_API_TOKEN='...'"
tmux send-keys -t pi-test "export PREFACTOR_AGENT_ID='...'"
tmux send-keys -t pi-test "pi -e ./src/index.ts"
```

**What to Watch For**:
- ✅ `config_loaded` - Configuration parsed correctly
- ✅ `agent_init` - HTTP client initialized
- ✅ `extension_initialized` - All hooks registered
- ❌ Any error messages (missing config, API failures)

---

### Step 2: Interact with Pi

```bash
tmux send-keys -t pi-test "What files are in this directory?" Enter
```

**What to Watch For**:
- ✅ `input` - User message received
- ✅ `interaction_span_created` - Interaction span started
- ✅ `user_message_span_created` - Message captured
- ✅ `agent_run_span_created` - Agent started processing
- ✅ `tool_execution_start` - Tool called (if applicable)
- ✅ `tool_call_span_created` - Tool span created
- ✅ `assistant_response_span_created` - Response captured
- ✅ `agent_run_span_closed` - Agent finished

---

### Step 3: Verify in Prefactor Backend

```bash
# Get latest agent instance
./dist/bin/cli.js agent_instances list --agent_id YOUR_AGENT_ID \
  | grep -E '"id":|"inserted_at":'

# Query spans for that instance
./dist/bin/cli.js agent_spans list \
  --agent_instance_id INSTANCE_ID \
  --start_time START \
  --end_time END
```

**What to Verify**:
- ✅ Agent instance exists with recent `inserted_at` timestamp
- ✅ Spans present with correct `schema_name` values
- ✅ `parent_span_id` relationships correct (hierarchy)
- ✅ `payload` contains expected data (user message text, etc.)
- ✅ Timestamps match interaction time

---

### Step 4: Correlate Logs with Backend Data

**Match span IDs from logs to CLI output**:

From logs:
```
[00:17:34.067Z] [pi-prefactor:session_span_created] spanId=01kp2378ct4x99bmcy4n6f9qhkmxmwxx
```

From CLI:
```json
{
  "id": "01kp2378ct4x99bmcy4n6f9qhkmxmwxx",
  "schema_name": "pi:session"
}
```

**If IDs match**: ✅ Span successfully sent to backend  
**If IDs don't match**: ❌ Check for API errors, network issues, retry queue

---

## Common Issues and Solutions

### Issue 1: "Missing required configuration"

**Symptoms**:
```
[pi-prefactor] Configuration error: Missing required configuration: PREFACTOR_API_TOKEN, PREFACTOR_AGENT_ID
```

**Cause**: Environment variables not set

**Solution**:
```bash
export PREFACTOR_API_TOKEN='your-token'
export PREFACTOR_AGENT_ID='your-agent-id'
# Then restart pi
```

**Verification**:
```
[pi-prefactor:config_loaded] agentId=01knv0ft...
```

---

### Issue 2: "Cannot find module 'zod'"

**Symptoms**:
```
Error: Failed to load extension: Cannot find module 'zod'
```

**Cause**: Dependencies not installed in extension directory

**Solution**:
```bash
cd /path/to/pi-prefactor-ext
bun install
```

**Verification**:
```
ls node_modules/zod  # Should exist
```

---

### Issue 3: "tool_call_span_not_found"

**Symptoms**:
```
[pi-prefactor:tool_call_span_not_found] sessionKey=... toolCallId=abc123
```

**Cause**: Tool result arrived before span was created (race condition)

**Solution**: 
- Ensure `tool_execution_start` handler creates span BEFORE tool executes
- Check hook registration order in `index.ts`

**Verification**:
```
# Should see tool_execution_start BEFORE tool_result
[00:18:03.537Z] [pi-prefactor:tool_execution_start]
[00:18:03.576Z] [pi-prefactor:tool_result]
```

---

### Issue 4: Spans Not Appearing in Backend

**Symptoms**:
- Logs show `span_created`
- CLI query returns no spans or old spans

**Possible Causes**:
1. API token invalid/expired
2. Network connectivity issue
3. Agent instance not registered
4. Retry queue backlog

**Debugging Steps**:

1. **Check agent registration**:
   ```bash
   ./dist/bin/cli.js agent_instances list --agent_id YOUR_AGENT_ID
   ```
   Should show instance with recent timestamp

2. **Check logs for errors**:
   ```bash
   tmux capture-pane -t pi-test -p | grep "error\|failed"
   ```

3. **Verify API credentials**:
   ```bash
   echo $PREFACTOR_API_TOKEN | cut -c1-20  # Should show start of token
   ```

4. **Check retry queue** (if implemented):
   ```
   [pi-prefactor:retry_queue_operation_failed] ...
   ```

**Solution**:
- Regenerate API token if expired
- Check network connectivity
- Restart pi to re-register agent instance

---

### Issue 5: Wrong Span Hierarchy

**Symptoms**:
- Spans created but `parent_span_id` incorrect
- Spans appear as orphans in Prefactor UI

**Cause**: Parent span ID not passed correctly to `createSpan()`

**Solution**:
```typescript
// In session-state.ts
const spanId = await this.agent.createSpan(
  sessionKey,
  'pi:user_message',
  payload,
  state.interactionSpanId  // ← Ensure this is correct parent
);
```

**Verification**:
```bash
# Query spans and check parent relationships
./dist/bin/cli.js agent_spans list --agent_instance_id ID ... \
  | grep -E '"id":|"parent_span_id":|"schema_name":'
```

Expected hierarchy:
```
pi:session (no parent)
  └─ pi:user_interaction (parent: session)
      ├─ pi:user_message (parent: interaction)
      └─ pi:agent_run (parent: interaction)
          └─ pi:tool_call (parent: agent_run)
```

---

## Validation Checklist

Use this checklist to validate the extension is working correctly:

### Pre-flight Checks
- [ ] Environment variables set (`PREFACTOR_API_TOKEN`, `PREFACTOR_AGENT_ID`)
- [ ] Dependencies installed (`bun install`)
- [ ] Extension in correct location (`~/.pi/agent/extensions/` or `.pi/extensions/`)
- [ ] Pi can load extension (no "Cannot find module" errors)

### Runtime Validation
- [ ] `config_loaded` log appears
- [ ] `agent_init` log appears
- [ ] `extension_initialized` log shows correct hook count (11 for MVP)
- [ ] `agent_instance_registered` log appears with instance ID
- [ ] `session_span_created` log appears

### Interaction Validation
- [ ] Ask pi a question
- [ ] `input` log appears
- [ ] `interaction_span_created` log appears
- [ ] `user_message_span_created` log appears
- [ ] `agent_run_span_created` log appears
- [ ] `assistant_response_span_created` log appears
- [ ] `agent_run_span_closed` log appears

### Backend Validation
- [ ] Agent instance appears in CLI query with recent timestamp
- [ ] Spans appear in CLI query for the instance
- [ ] Span `schema_name` values are correct (pi:session, pi:user_message, etc.)
- [ ] `parent_span_id` relationships form correct hierarchy
- [ ] `payload` contains expected data (user message text, timestamps)
- [ ] Span timestamps match interaction time

### Error Handling
- [ ] No `error` or `failed` messages in logs
- [ ] No `tool_call_span_not_found` warnings
- [ ] No API authentication errors (401/403)

---

## Best Practices

### 1. Always Use Tmux for Testing

**Why**: Pi processes can run for extended periods; tmux keeps them alive and lets you monitor multiple scenarios.

**Pattern**:
```bash
# Create session
tmux new-session -d -s test-name

# Send setup commands
tmux send-keys -t test-name "export VAR=value" Enter
tmux send-keys -t test-name "pi -e ./extension.ts" Enter

# Monitor
tmux capture-pane -t test-name -p | tail -50
```

### 2. Log Everything

**Why**: Real-time logs are invaluable for debugging timing issues and span creation order.

**Pattern**:
```typescript
// In every hook handler
logger.info('hook_name', {
  sessionKey,
  relevantData,
});
```

### 3. Query Backend Immediately After Interaction

**Why**: Confirms spans are actually reaching Prefactor, not just being created locally.

**Pattern**:
```bash
# Interact with pi
tmux send-keys -t pi-test "Question?" Enter

# Wait for processing
sleep 10

# Query backend
./dist/bin/cli.js agent_spans list --agent_instance_id ID --start_time NOW --end_time NOW+1min
```

### 4. Correlate Span IDs

**Why**: Ensures local span creation matches backend storage.

**Pattern**:
```bash
# Extract span ID from logs
tmux capture-pane -t pi-test -p | grep "span_created" | grep -o 'spanId=[^ ]*'

# Match with CLI output
./dist/bin/cli.js agent_spans list ... | grep '"id":'
```

### 5. Test with Real Credentials Early

**Why**: Catches API authentication and network issues before deep development.

**Pattern**:
```bash
# Day 1: Test basic connectivity
export PREFACTOR_API_TOKEN='real-token'
export PREFACTOR_AGENT_ID='real-agent-id'
pi -e ./minimal-extension.ts

# Verify in backend
./dist/bin/cli.js agent_instances list --agent_id real-agent-id
```

---

## Quick Reference Commands

### Tmux
```bash
tmux new-session -d -s name          # Create session
tmux attach -t name                  # Attach to session
tmux capture-pane -t name -p | tail  # View output
tmux send-keys -t name "cmd" Enter   # Send command
tmux kill-session -t name            # Kill session
```

### Prefactor CLI
```bash
./dist/bin/cli.js profiles add default --api-token TOKEN
./dist/bin/cli.js agents list --environment_id ID
./dist/bin/cli.js agent_instances list --agent_id ID
./dist/bin/cli.js agent_spans list --agent_instance_id ID --start_time T --end_time T
```

### Git
```bash
git status
git diff
git add -A
git commit -m "message"
git push
git log --oneline
```

### Extension Testing
```bash
export PREFACTOR_API_TOKEN='...'
export PREFACTOR_AGENT_ID='...'
pi -e ./src/index.ts
```

---

## Lessons Learned

1. **Tmux is Essential**: Running pi in tmux sessions allows parallel testing and preserves state for debugging.

2. **CLI is Truth**: Logs show what the extension is doing, but CLI queries confirm what the backend received.

3. **Timestamps Matter**: Always use recent time ranges when querying spans; old instances clutter results.

4. **Span Hierarchy is Critical**: Parent-child relationships must be correct for Prefactor UI to display properly.

5. **Test Early, Test Often**: Validate with real credentials from day 1; don't wait until "everything is ready".

6. **Log Span IDs**: Including span IDs in logs makes correlation with backend data trivial.

7. **Race Conditions Exist**: Tool execution is concurrent; ensure spans are created before tools execute.

8. **Graceful Degradation**: Extension should work (with reduced functionality) even if API is unavailable.

---

## Contact

For questions about this debugging approach, refer to:
- `PLAN-v2.md` - Implementation plan
- `MVP-GAPS.md` - Gap analysis
- `TEST-RESULTS.md` - Test validation results
- `README.md` - Extension documentation
