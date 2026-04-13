# Product Requirements Document: P0 Critical Fixes

**Version**: 1.0  
**Date**: 2026-04-13  
**Priority**: P0 CRITICAL  
**Status**: Ready for Implementation  

---

## Problem Statement

The pi-prefactor extension **fails to meet core requirements** for auditable logging of agent actions. Current implementation captures span structure but **insufficient data** to:

1. Reconstruct what an agent did in a coding session
2. Assess harness effectiveness for software development
3. Share agent interactions with team members

**Critical Finding**: Looking at Prefactor backend, you **cannot** answer:
- What command was run?
- What file was modified?
- Did the tool succeed or fail?
- How long did the session take?

---

## Goals

### Primary Goal

Enable users to look at a Prefactor session and **completely understand what the agent did**, including:
- What files were read/modified
- What commands were executed
- What the outcomes were (success/fail)
- How long operations took
- Whether the session succeeded

### Success Metrics

After implementation, users must be able to answer from Prefactor alone:

| Question | Current | Target |
|----------|---------|--------|
| What command was run? | ❌ No | ✅ Yes (full command + cwd) |
| What was the output? | ❌ No | ✅ Yes (stdout/stderr/exit code) |
| What files were modified? | ❌ No | ✅ Yes (paths + backup info) |
| Did tools succeed/fail? | ❌ No | ✅ Yes (with error details) |
| How long did it take? | ❌ No | ✅ Yes (duration per span + total) |
| What was the outcome? | ❌ No | ✅ Yes (success/fail + reason) |
| Would a team member understand? | ❌ No | ✅ Yes |

---

## Scope

### In Scope (P0 Critical Fixes)

1. **Tool-Specific Span Schemas** - Use `pi:tool:bash`, `pi:tool:read`, `pi:tool:write`, `pi:tool:edit`
2. **Full Tool Input/Output Capture** - Commands, files, exit codes, outputs
3. **Duration Tracking** - Start/end timestamps on all spans
4. **Agent Run Payload** - Model, tokens, outcome, files modified
5. **File Change Tracking** - Paths, backups, success/fail

### Out of Scope (Defer to P1/P2)

- Circuit breaker for API reliability
- Token usage tracking (important but not blocking core requirement)
- Session summary spans
- Turn span debugging
- Thinking/reasoning capture
- Team sharing UI features
- Model selection tracking

---

## Detailed Specifications

### Fix 1: Tool-Specific Span Schemas

**Problem**: All tools use generic `pi:tool_call` schema instead of specific types.

**Current Code** (src/index.ts ~line 340):
```typescript
const schemaName = `pi:tool:${event.toolName}` as 'pi:tool_call';  // WRONG!
```

**Required Behavior**:
- `bash` tool → `pi:tool:bash` schema
- `read` tool → `pi:tool:read` schema
- `write` tool → `pi:tool:write` schema
- `edit` tool → `pi:tool:edit` schema
- Unknown tools → `pi:tool_call` (fallback only)

**Schema Definitions** (add to src/agent.ts):

```typescript
// pi:tool:bash
{
  name: 'pi:tool:bash',
  description: 'Bash command execution',
  template: '{{ command | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      toolCallId: { type: 'string', description: 'Tool call ID' },
      command: { type: 'string', description: 'Bash command to execute' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', description: 'Timeout in milliseconds' },
      // Result fields (on finish)
      exitCode: { type: 'number', description: 'Exit code' },
      stdout: { type: 'string', description: 'Standard output (truncated to maxOutputLength)' },
      stderr: { type: 'string', description: 'Standard error (truncated to maxOutputLength)' },
      durationMs: { type: 'number', description: 'Execution duration' },
      isError: { type: 'boolean', description: 'Whether command failed' },
    },
    required: ['toolCallId', 'command', 'isError'],
  },
}

// pi:tool:read
{
  name: 'pi:tool:read',
  description: 'File read operation',
  template: '{{ path | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      toolCallId: { type: 'string', description: 'Tool call ID' },
      path: { type: 'string', description: 'File path to read' },
      offset: { type: 'number', description: 'Start line number' },
      limit: { type: 'number', description: 'Maximum lines to read' },
      // Result fields
      contentLength: { type: 'number', description: 'Bytes read' },
      lineCount: { type: 'number', description: 'Lines read' },
      encoding: { type: 'string', description: 'File encoding' },
      isError: { type: 'boolean', description: 'Whether read failed' },
    },
    required: ['toolCallId', 'path', 'isError'],
  },
}

// pi:tool:write
{
  name: 'pi:tool:write',
  description: 'File write operation',
  template: '{{ path | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      toolCallId: { type: 'string', description: 'Tool call ID' },
      path: { type: 'string', description: 'File path to write' },
      contentLength: { type: 'number', description: 'Bytes written' },
      created: { type: 'boolean', description: 'Whether file was created (vs updated)' },
      // Result fields
      backupPath: { type: 'string', description: 'Backup file path if created' },
      success: { type: 'boolean', description: 'Write success' },
      isError: { type: 'boolean', description: 'Whether write failed' },
    },
    required: ['toolCallId', 'path', 'contentLength', 'isError'],
  },
}

// pi:tool:edit
{
  name: 'pi:tool:edit',
  description: 'File edit operation',
  template: '{{ path | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      toolCallId: { type: 'string', description: 'Tool call ID' },
      path: { type: 'string', description: 'File path to edit' },
      editCount: { type: 'number', description: 'Number of edit blocks' },
      // Result fields
      successCount: { type: 'number', description: 'Successful edits' },
      failedCount: { type: 'number', description: 'Failed edits' },
      isError: { type: 'boolean', description: 'Whether edit failed' },
    },
    required: ['toolCallId', 'path', 'editCount', 'isError'],
  },
}
```

**Acceptance Criteria**:
- [ ] All 4 tool schemas registered in `agentSchemaVersion.span_type_schemas`
- [ ] Tool handler uses correct schema based on `event.toolName`
- [ ] Unknown tools fall back to `pi:tool_call`
- [ ] TypeScript compilation passes
- [ ] Prefactor backend accepts spans (no schema validation errors)

---

### Fix 2: Full Tool Input/Output Capture

**Problem**: Tool spans capture minimal data, missing critical information.

**Required Implementation**:

#### tool_execution_start Handler (src/index.ts)

```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) return;
  
  const startTime = Date.now();
  
  // Determine schema name based on tool name
  const schemaName = getToolSchemaName(event.toolName);
  
  // Build tool-specific payload with START time
  const payload: Record<string, unknown> = {
    toolCallId: event.toolCallId,
    startTime,  // CRITICAL: Track start time for duration
  };
  
  if (config.captureToolInputs) {
    if (event.toolName === 'bash') {
      const args = event.args as { command?: string; timeout?: number; cwd?: string };
      payload.command = args.command;
      payload.cwd = args.cwd;
      payload.timeout = args.timeout;
    } else if (event.toolName === 'read') {
      const args = event.args as { path?: string; offset?: number; limit?: number };
      payload.path = args.path;
      payload.offset = args.offset;
      payload.limit = args.limit;
    } else if (event.toolName === 'write') {
      const args = event.args as { path?: string; content?: string };
      payload.path = args.path;
      payload.contentLength = args.content?.length;
      payload.created = (event as any).created;
    } else if (event.toolName === 'edit') {
      const args = event.args as { path?: string; edits?: any[] };
      payload.path = args.path;
      payload.editCount = args.edits?.length;
    }
  }
  
  await sessionManager.createToolCallSpan(sessionKey, event.toolName, payload, schemaName);
});
```

#### tool_result Handler (src/index.ts)

```typescript
pi.on("tool_result", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) return;
  
  const endTime = Date.now();
  const isError = event.isError ?? false;
  
  // Build result payload based on tool type
  const resultPayload: Record<string, unknown> = {
    isError,
    endTime,  // CRITICAL: Track end time for duration
  };
  
  if (config.captureToolOutputs && !isError) {
    if (event.toolName === 'bash') {
      const result = event.result as { exitCode?: number; stdout?: string; stderr?: string; durationMs?: number };
      resultPayload.exitCode = result.exitCode;
      resultPayload.stdout = result.stdout?.slice(0, config.maxOutputLength);
      resultPayload.stderr = result.stderr?.slice(0, config.maxOutputLength);
      resultPayload.durationMs = result.durationMs || (endTime - startTime);
    } else if (event.toolName === 'read') {
      const result = event.result as { content?: string; lineCount?: number; encoding?: string };
      resultPayload.contentLength = result.content?.length;
      resultPayload.lineCount = result.lineCount;
      resultPayload.encoding = result.encoding;
    } else if (event.toolName === 'write') {
      const result = event.result as { success?: boolean; backupPath?: string };
      resultPayload.success = result.success;
      resultPayload.backupPath = result.backupPath;
    } else if (event.toolName === 'edit') {
      const result = event.result as { successCount?: number; failedCount?: number };
      resultPayload.successCount = result.successCount;
      resultPayload.failedCount = result.failedCount;
    }
  }
  
  await sessionManager.closeToolCallSpanWithResult(
    sessionKey,
    event.toolCallId,
    event.toolName,
    resultPayload,
    isError
  );
});
```

**Acceptance Criteria**:
- [ ] Bash tool captures: command, cwd, timeout, exitCode, stdout, stderr, durationMs
- [ ] Read tool captures: path, offset, limit, contentLength, lineCount, encoding
- [ ] Write tool captures: path, contentLength, created, backupPath, success
- [ ] Edit tool captures: path, editCount, successCount, failedCount
- [ ] All tools capture: startTime, endTime, durationMs, isError
- [ ] Payloads truncated to config.maxOutputLength
- [ ] Validated with Prefactor CLI (can see full command, output, etc.)

---

### Fix 3: Duration Tracking

**Problem**: No spans track how long operations took.

**Required Implementation**:

#### Add Start Time to All Spans

Every span creation must include `startTime`:

```typescript
// In all span creation methods
const startTime = Date.now();

await this.agent.createSpan(sessionKey, schemaName, {
  ...payload,
  startTime,  // ISO timestamp or epoch ms
}, parentSpanId);
```

#### Add End Time to All Span Finishes

Every span finish must include `endTime` and calculate `durationMs`:

```typescript
// In all span finish methods
const endTime = Date.now();
const durationMs = endTime - startTime;

await this.agent.finishSpan(sessionKey, spanId, status, {
  ...payload,
  endTime,
  durationMs,
});
```

#### Specific Spans to Update

**pi:agent_run**:
```typescript
// before_agent_start handler
const startTime = Date.now();
await sessionManager.createAgentRunSpan(sessionKey, {
  startTime,
  model: ctx.model?.id,
  messageCount: event.messages?.length,
  // ... other fields
});

// agent_end handler
const endTime = Date.now();
await sessionManager.closeAgentRunSpan(sessionKey, {
  endTime,
  durationMs: endTime - startTime,
  success: event.success,
  // ... other fields
});
```

**pi:assistant_response**:
```typescript
// In turn_end handler, when creating assistant_response span
const startTime = Date.now();
const spanId = await sessionManager.createAssistantResponseSpan(...);

// Close immediately with duration
await sessionManager.closeAssistantResponseSpan(sessionKey, {
  endTime: Date.now(),
  durationMs: Date.now() - startTime,
  // ... other fields
});
```

**pi:user_message**:
```typescript
// In input handler
const startTime = Date.now();
await sessionManager.createUserMessageSpan(sessionKey, {
  text: event.text,
  startTime,
  timestamp: new Date().toISOString(),
});

// Close immediately
await sessionManager.closeUserMessageSpan(sessionKey, {
  endTime: Date.now(),
  durationMs: Date.now() - startTime,
});
```

**Acceptance Criteria**:
- [ ] All spans include startTime and endTime
- [ ] All spans include durationMs
- [ ] Duration is accurate (endTime - startTime)
- [ ] Can query Prefactor for "show me all operations > 1 second"
- [ ] Can calculate total session duration from spans

---

### Fix 4: Agent Run Payload

**Problem**: `pi:agent_run` captures `{messageCount: 0}` - useless data.

**Required Payload**:

```typescript
{
  startTime: number,
  endTime: number,
  durationMs: number,
  model: string,                    // Which model was used
  messageCount: number,             // Messages in conversation
  success: boolean,                 // Whether agent succeeded
  filesModified: string[],          // Paths of files changed
  commandsRun: number,              // Count of bash commands
  toolCalls: number,                // Count of tool calls
  error?: string,                   // Error message if failed
  reason?: string,                  // Completion reason
}
```

**Implementation**:

```typescript
// In before_agent_start handler
pi.on("before_agent_start", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) return;
  
  const startTime = Date.now();
  
  logger.debug('before_agent_start', {
    sessionKey,
    model: ctx.model?.id,
    messages: event.messages?.length,
  });
  
  await sessionManager.createAgentRunSpan(sessionKey, {
    startTime,
    model: ctx.model?.id,
    messageCount: event.messages?.length,
  });
});

// In agent_end handler
pi.on("agent_end", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) return;
  
  const endTime = Date.now();
  const state = sessionManager.getSessionState(sessionKey);
  
  logger.debug('agent_end', {
    sessionKey,
    success: event.success,
    messageCount: event.messages?.length,
  });
  
  await sessionManager.closeAgentRunSpan(sessionKey, {
    endTime,
    durationMs: endTime - startTime,
    success: event.success ?? true,
    filesModified: state?.filesModified ? Array.from(state.filesModified) : [],
    commandsRun: state?.commandsRun || 0,
    toolCalls: state?.toolCalls || 0,
    reason: event.success ? 'completed' : 'failed',
  });
});
```

**Session State Tracking** (src/session-state.ts):

```typescript
interface SessionSpanState {
  // ... existing fields
  
  // File and activity tracking
  filesModified: Set<string>;
  commandsRun: number;
  toolCalls: number;
}

// In tool_result handler, track activity
if (event.toolName === 'write' || event.toolName === 'edit') {
  const path = (event.args as { path?: string }).path;
  if (path) {
    state.filesModified.add(path);
  }
}

if (event.toolName === 'bash') {
  state.commandsRun++;
}

state.toolCalls++;
```

**Acceptance Criteria**:
- [ ] pi:agent_run captures model, duration, success
- [ ] pi:agent_run captures filesModified array
- [ ] pi:agent_run captures activity counts (commands, tools)
- [ ] Can query "show me all agent runs that modified files"
- [ ] Can query "show me failed agent runs with error reason"

---

### Fix 5: File Change Tracking

**Problem**: Cannot see what files were modified.

**Required Implementation**:

#### Track File Operations in Session State

```typescript
// In src/session-state.ts
interface SessionSpanState {
  // ... existing
  filesModified: Set<string>;
  filesRead: Set<string>;
  filesCreated: string[];
}

// Initialize in getOrCreateSessionState
filesModified: new Set(),
filesRead: new Set(),
filesCreated: [],

// In tool_result handler (src/index.ts)
if (event.toolName === 'write' || event.toolName === 'edit') {
  const path = (event.args as { path?: string }).path;
  if (path && !isError) {
    state.filesModified.add(path);
    
    if (event.toolName === 'write' && (event as any).created) {
      state.filesCreated.push(path);
    }
  }
}

if (event.toolName === 'read') {
  const path = (event.args as { path?: string }).path;
  if (path && !isError) {
    state.filesRead.add(path);
  }
}
```

#### Include File Info in Spans

**pi:tool:write** and **pi:tool:edit** payloads must include `path`.

**pi:agent_run** result payload must include `filesModified` array.

**Acceptance Criteria**:
- [ ] Can query "show me all files modified in this session"
- [ ] Can query "show me all sessions that modified file X"
- [ ] Can distinguish files created vs updated
- [ ] Can see files read (for context understanding)

---

## Testing Requirements

### Test 1: Tool-Specific Schemas

**Command**:
```bash
pi -p -e ./src/index.ts "List files using bash"
```

**Verify in Prefactor**:
```bash
cd /home/sprite/typescript-sdk/packages/cli
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID | jq -r '.summaries[0].id')
START="2026-04-13T00:00:00Z"
END="2026-04-13T23:59:59Z"

bun ./dist/bin/cli.js agent_spans list \
  --agent_instance_id "$INSTANCE_ID" \
  --start_time "$START" \
  --end_time "$END" \
  --include_summaries \
  | jq '.summaries[] | select(.schema_name | startswith("pi:tool:")) | {schema_name, payload}'
```

**Expected Output**:
```json
{
  "schema_name": "pi:tool:bash",
  "payload": {
    "command": "ls -la",
    "cwd": "/home/sprite/typescript-sdk",
    "exitCode": 0,
    "stdout": "total 52\n...",
    "stderr": "",
    "durationMs": 123,
    "isError": false
  }
}
```

**Acceptance**:
- ✅ Schema is `pi:tool:bash` (not `pi:tool_call`)
- ✅ Command is visible
- ✅ Exit code is visible
- ✅ Stdout/stderr are visible
- ✅ Duration is visible

---

### Test 2: Duration Tracking

**Command**:
```bash
pi -p -e ./src/index.ts "Read README.md and count lines"
```

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | {schema_name, durationMs: (.payload.durationMs // .result_payload.durationMs)}'
```

**Expected**: All spans have `durationMs` > 0

**Acceptance**:
- ✅ Every span has durationMs
- ✅ Durations are reasonable (not 0, not negative)
- ✅ Can calculate total session duration

---

### Test 3: Agent Run Payload

**Command**:
```bash
pi -p -e ./src/index.ts "Create a test file with echo"
```

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload'
```

**Expected**:
```json
{
  "model": "qwen3.5:cloud",
  "durationMs": 5432,
  "success": true,
  "filesModified": ["test.txt"],
  "commandsRun": 1,
  "toolCalls": 1,
  "reason": "completed"
}
```

**Acceptance**:
- ✅ Model is captured
- ✅ Duration is captured
- ✅ Success/fail is captured
- ✅ Files modified array is populated
- ✅ Activity counts are accurate

---

### Test 4: File Change Tracking

**Command**:
```bash
pi -p -e ./src/index.ts "Create a file called test.txt with content 'hello', then read it back"
```

**Verify**:
```bash
# Check agent_run for filesModified
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.filesModified'

# Check tool spans for file paths
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name | startswith("pi:tool:")) | {schema_name, path: .payload.path}'
```

**Expected**:
```json
["test.txt"]

{"schema_name": "pi:tool:write", "path": "test.txt"}
{"schema_name": "pi:tool:read", "path": "test.txt"}
```

**Acceptance**:
- ✅ Files modified array is accurate
- ✅ Tool spans include file paths
- ✅ Can see what was written and read

---

### Test 5: Complete Session Reconstruction

**Command**:
```bash
pi -p -e ./src/index.ts "Create a file called hello.py with a print statement, then run it"
```

**Expected Agent Actions**:
1. Write file `hello.py`
2. Run bash command `python hello.py`
3. Respond with output

**Verify**: Can you answer all questions from Prefactor alone?

```bash
# 1. What was the user request?
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:user_message") | .payload.text'

# 2. What files were modified?
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.filesModified'

# 3. What commands were run?
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:tool:bash") | .payload.command'

# 4. What was the output?
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:tool:bash") | {stdout: .result_payload.stdout, exitCode: .result_payload.exitCode}'

# 5. How long did it take?
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.durationMs'

# 6. Did it succeed?
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload.success'
```

**Acceptance**:
- ✅ Can answer ALL 6 questions from Prefactor data alone
- ✅ A team member could understand what happened without running the session

---

## Implementation Checklist

### Phase 1: Schema Definitions (30 min)

- [ ] Add `pi:tool:bash` schema to `agentSchemaVersion`
- [ ] Add `pi:tool:read` schema to `agentSchemaVersion`
- [ ] Add `pi:tool:write` schema to `agentSchemaVersion`
- [ ] Add `pi:tool:edit` schema to `agentSchemaVersion`
- [ ] TypeScript compilation passes

### Phase 2: Tool Handlers (60 min)

- [ ] Update `tool_execution_start` to use specific schemas
- [ ] Update `tool_execution_start` to capture full inputs
- [ ] Update `tool_result` to capture full outputs
- [ ] Add startTime/endTime tracking
- [ ] Add durationMs calculation
- [ ] Test with bash command
- [ ] Test with read file
- [ ] Test with write file
- [ ] Test with edit file

### Phase 3: Agent Run Payload (30 min)

- [ ] Add file tracking to SessionSpanState
- [ ] Track filesModified in tool_result handler
- [ ] Track commandsRun in tool_result handler
- [ ] Track toolCalls in tool_result handler
- [ ] Update before_agent_start to capture model
- [ ] Update agent_end to capture outcome
- [ ] Test with file modification scenario

### Phase 4: Duration Tracking (30 min)

- [ ] Add startTime to all span creations
- [ ] Add endTime/durationMs to all span finishes
- [ ] Test duration accuracy
- [ ] Verify all spans have duration

### Phase 5: Validation (30 min)

- [ ] Run Test 1 (tool-specific schemas)
- [ ] Run Test 2 (duration tracking)
- [ ] Run Test 3 (agent run payload)
- [ ] Run Test 4 (file change tracking)
- [ ] Run Test 5 (complete reconstruction)
- [ ] All tests pass
- [ ] Commit with validation results

---

## Files to Modify

| File | Changes | Estimated Lines |
|------|---------|-----------------|
| `src/agent.ts` | Add 4 tool schemas | ~150 |
| `src/index.ts` | Update tool handlers, agent handlers | ~120 |
| `src/session-state.ts` | Add file tracking, duration | ~80 |
| **Total** | **3 files** | **~350 lines** |

---

## Acceptance Criteria (Definition of Done)

**P0 Critical Fixes are complete when**:

1. ✅ All 4 tool schemas registered and working
2. ✅ Tool inputs/outputs fully captured (command, file paths, exit codes, outputs)
3. ✅ All spans track duration (startTime, endTime, durationMs)
4. ✅ pi:agent_run captures model, outcome, files modified, activity counts
5. ✅ File changes tracked (filesModified, filesRead, filesCreated)
6. ✅ All 5 tests pass
7. ✅ Can completely reconstruct a coding session from Prefactor data alone
8. ✅ TypeScript compilation passes
9. ✅ No regressions in existing functionality
10. ✅ Committed with validation results

---

## Out of Scope (Explicitly Deferred)

These are **NOT** part of P0:

- ❌ Circuit breaker for API reliability
- ❌ Token usage tracking
- ❌ Session summary spans
- ❌ Turn span debugging/fixes
- ❌ Thinking/reasoning capture
- ❌ Model selection tracking
- ❌ Team sharing UI features
- ❌ before_provider_request hook
- ❌ resources_discover hook
- ❌ session_before_* hooks

**Rationale**: These do not block the core requirement of "can understand what the agent did from Prefactor data". They can be added after P0 is complete.

---

## Success Statement

**After P0 implementation, a user can**:

1. Open Prefactor UI
2. Select any coding session
3. See exactly what files were read/modified
4. See exactly what commands were run (with output)
5. See whether each operation succeeded or failed
6. See how long the session took
7. Share the session with a team member who can understand what was done

**The extension becomes an auditable log of agent actions with sufficient resolution to assess effectiveness.**

---

**Ready for implementation. Spawn agent with this PRD and execute to specification.**
