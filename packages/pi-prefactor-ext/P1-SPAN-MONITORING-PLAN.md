# P1 Span Monitoring Plan

**Date**: 2026-04-13  
**Goal**: Use real agent sessions to identify gaps and prioritize next improvements  

---

## Approach

Spawn multiple agents with **different task types**, monitor spans in Prefactor, analyze what's captured vs. what's missing.

---

## Test Scenarios

### Scenario 1: Simple File Operations
**Task**: "Create a file called test1.txt with content 'hello', read it back, then delete it"

**Expected Spans**:
- pi:session
- pi:user_message
- pi:agent_run
  - pi:tool:write (create)
  - pi:tool:read (verify)
  - pi:tool:bash (delete)

**Validate**:
- ✅ File paths captured
- ✅ Commands captured
- ✅ Success/fail tracked
- ❓ Content captured? (should NOT capture full content for security)
- ❓ Diffs tracked? (likely missing)

---

### Scenario 2: Bash-Heavy Session
**Task**: "List all .md files, count them, create a summary file with the count"

**Expected Spans**:
- pi:tool:bash (find *.md)
- pi:tool:bash (wc -l)
- pi:tool:write (summary)

**Validate**:
- ✅ Multiple bash commands tracked
- ✅ Exit codes captured
- ✅ stdout/stderr captured
- ❓ Working directory tracked?
- ❓ Command duration per command?

---

### Scenario 3: Multi-Turn Conversation
**Task**: "First create a file. Then read it. Then modify it."

**Expected Spans**:
- pi:agent_run (should have multiple turns)
- Multiple tool spans

**Validate**:
- ✅ Turn count tracked?
- ✅ Each turn distinguishable?
- ❓ Turn-level outcomes tracked?

---

### Scenario 4: Error Scenarios
**Task**: "Try to read a non-existent file, then try to write to a read-only location"

**Expected Spans**:
- pi:tool:read (should fail)
- pi:tool:write (should fail)

**Validate**:
- ✅ isError: true captured?
- ✅ Error messages captured?
- ✅ stderr captured?
- ❓ Retry attempts tracked?

---

### Scenario 5: Complex Coding Task
**Task**: "Create a simple TypeScript function, create a test file, run the test"

**Expected Spans**:
- pi:tool:write (function)
- pi:tool:write (test)
- pi:tool:bash (run test)

**Validate**:
- ✅ Multiple file writes tracked
- ✅ Test execution tracked
- ✅ Test results captured?
- ❓ Code quality signals? (lint, build errors)

---

### Scenario 6: Long-Running Session
**Task**: "Create 5 files with different content, then list all files created"

**Expected Spans**:
- 5x pi:tool:write
- 1x pi:tool:bash

**Validate**:
- ✅ All 5 files tracked in filesModified?
- ✅ Duration reasonable?
- ❓ Performance bottlenecks visible?

---

## Monitoring Commands

### Watch New Instances

```bash
cd /home/sprite/typescript-sdk/packages/cli

# Watch for new instances
watch -n 2 'bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID | jq ".summaries[:3] | .[] | {id, started_at}"'
```

### Query Spans for Latest Instance

```bash
# Get latest instance
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID | jq -r '.summaries[0].id')

# Query all spans
START="2026-04-13T00:00:00Z"
END="2026-04-13T23:59:59Z"

bun ./dist/bin/cli.js agent_spans list \
  --agent_instance_id "$INSTANCE_ID" \
  --start_time "$START" \
  --end_time "$END" \
  | jq '.summaries | group_by(.schema_name) | .[] | {schema: .[0].schema_name, count: length}'
```

### Inspect Specific Span Types

```bash
# agent_run details
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | {payload, result_payload}'

# tool spans with paths/commands
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name | startswith("pi:tool:")) | {schema_name, payload: (.payload | {path, command}), result_payload: (.result_payload | {isError, exitCode})}'

# Check for missing fields
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:agent_run") | .result_payload | {hasTokens: (.tokens != null), hasUserRequest: (.userRequest != null), hasSkills: (.skillsLoaded != null)}'
```

---

## Data Collection Template

For each session, document:

```markdown
## Session: {instance_id}

**Task**: {description}

**Spans Created**:
- pi:session: {count}
- pi:user_message: {count}
- pi:agent_run: {count}
- pi:tool:bash: {count}
- pi:tool:read: {count}
- pi:tool:write: {count}
- pi:tool:edit: {count}

**agent_run Payload**:
```json
{
  "model": "...",
  "userRequest": "...",
  "messageCount": N,
  "systemPrompt": "...",
  "skillsLoaded": [...],
  "toolsAvailable": [...]
}
```

**agent_run Result Payload**:
```json
{
  "success": true/false,
  "terminationReason": "...",
  "tokens": {...},
  "filesModified": [...],
  "durationMs": N
}
```

**What Worked**:
- ✅ ...

**What's Missing**:
- ❌ ...

**Questions We Can Answer**:
1. ...
2. ...

**Questions We Cannot Answer**:
1. ...
2. ...
```

---

## Analysis Framework

After collecting data from 6+ sessions, analyze:

### 1. Span Coverage

| Span Type | Expected | Actual | Gap |
|-----------|----------|--------|-----|
| pi:session | 100% | ?% | ? |
| pi:user_message | 100% | ?% | ? |
| pi:agent_run | 100% | ?% | ? |
| pi:tool:bash | 100% | ?% | ? |
| pi:tool:read | 100% | ?% | ? |
| pi:tool:write | 100% | ?% | ? |
| pi:tool:edit | 100% | ?% | ? |

---

### 2. Data Quality

| Field | Capture Rate | Quality | Notes |
|-------|--------------|---------|-------|
| model | ?% | ? | ... |
| userRequest | ?% | ? | ... |
| systemPrompt | ?% | ? | Pi API limitation |
| tokens | ?% | ? | Provider-dependent |
| filesModified | ?% | ? | ... |
| durationMs | ?% | ? | ... |
| terminationReason | ?% | ? | ... |
| error messages | ?% | ? | ... |

---

### 3. Question Answering

**For each core question, can Prefactor answer it?**

| Question | Yes/No | Which spans? | Missing data? |
|----------|--------|--------------|---------------|
| What did user ask? | ? | pi:user_message, pi:agent_run | - |
| What model was used? | ? | pi:agent_run | - |
| What files changed? | ? | pi:tool:write, pi:tool:edit | Diffs? |
| What commands ran? | ? | pi:tool:bash | - |
| Did it succeed? | ? | pi:agent_run | - |
| What went wrong? | ? | pi:tool:* (isError) | Error messages? |
| How long did it take? | ? | pi:agent_run | Per-operation? |
| How much did it cost? | ? | pi:agent_run (tokens) | Provider-dependent |
| What instructions? | ? | pi:agent_run (systemPrompt) | Pi API limitation |
| What tools available? | ? | pi:agent_run (toolsAvailable) | Pi API limitation |

---

### 4. Gap Analysis

**Critical Gaps** (blocking core requirements):
1. ...
2. ...
3. ...

**Important Gaps** (should have):
1. ...
2. ...

**Nice-to-Have** (future):
1. ...
2. ...

---

## Next Steps Prioritization

Based on findings, prioritize:

### P0 (Critical - Block Core Requirements)
- Fix: ...
- Add: ...

### P1 (Important - Should Have)
- Add: ...
- Improve: ...

### P2 (Future - Nice to Have)
- Add: ...
- Enhance: ...

---

## Execution Plan

### Phase 1: Spawn Agents (30 min)

Spawn 6 agents with different scenarios:
1. ✅ Simple file operations
2. ✅ Bash-heavy session
3. ✅ Multi-turn conversation
4. ✅ Error scenarios
5. ✅ Complex coding task
6. ✅ Long-running session

**Use timeouts**: `timeout 30 pi -p -e ./src/index.ts "task"`

---

### Phase 2: Collect Data (30 min)

For each session:
1. Get instance ID
2. Query all spans
3. Inspect agent_run payload
4. Inspect tool spans
5. Document what worked/missing
6. Fill data collection template

---

### Phase 3: Analyze (30 min)

1. Calculate span coverage
2. Assess data quality
3. Answer question matrix
4. Identify critical gaps
5. Prioritize next steps

---

### Phase 4: Plan (30 min)

1. Create P1 task list
2. Estimate effort
3. Define success criteria
4. Spawn implementation agent

---

## Success Criteria

**Monitoring is complete when**:

- ✅ 6+ sessions executed with different scenarios
- ✅ Span data collected for all sessions
- ✅ Coverage analysis complete
- ✅ Data quality assessed
- ✅ Question matrix answered
- ✅ Critical gaps identified
- ✅ P1 priorities defined
- ✅ Implementation plan created

---

**Ready to execute. Spawn monitoring agent to run scenarios and collect data.**
