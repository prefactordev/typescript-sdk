# Critical Assessment: Pi-Prefactor Extension

**Priority**: CRITICAL  
**Effort**: ~2-3 hours  
**Status**: Ready for implementation  

---

## Core Requirements

The Prefactor integration exists to:

1. **Auditable Log** - Complete record of actions a pi agent has taken
2. **Effectiveness Assessment** - Enough resolution to assess harness effectiveness for software development tasks
3. **Team Sharing** - Enable sharing pi agent interactions with team members

---

## Your Task

Critically assess the current extension implementation against these requirements. Answer honestly:

### Question 1: What Does Prefactor Currently Show?

**Action**: Query recent sessions from Prefactor CLI

```bash
cd /home/sprite/typescript-sdk/packages/cli

# Get recent instances
bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID

# For each recent instance, get spans
INSTANCE_ID="..."
START="2026-04-13T00:00:00Z"
END="2026-04-13T23:59:59Z"

bun ./dist/bin/cli.js agent_spans list \
  --agent_instance_id "$INSTANCE_ID" \
  --start_time "$START" \
  --end_time "$END" \
  --include_summaries
```

**Document**:
- What span types exist?
- What data is in each span's payload?
- What's missing that you'd need to understand what happened?

---

### Question 2: Can You Reconstruct What Happened?

**Test**: Pick a recent coding session from Prefactor

**Try to answer**:
1. What was the user's original request?
2. What files did the agent read/modify?
3. What commands did it run?
4. Did any tools fail? Why?
5. How long did the session take?
6. What was the final outcome?
7. Would another team member understand what was done?

**Document**: What questions can you answer? What's missing?

---

### Question 3: What's Missing for Software Development Assessment?

**For assessing harness effectiveness**, you'd need:

#### Code Changes
- [ ] Files modified (with diffs?)
- [ ] Lines added/removed
- [ ] Test files created/modified
- [ ] Build/compile results
- [ ] Test pass/fail results

#### Agent Behavior
- [ ] Time spent per task
- [ ] Tool success/failure rates
- [ ] Number of attempts per task
- [ ] Context switches (how often did it switch files?)
- [ ] Token usage per operation

#### Outcomes
- [ ] Task completed successfully?
- [ ] Code quality (linting, tests passing?)
- [ ] User satisfaction (did they accept the changes?)
- [ ] Time to completion vs. human baseline

**Document**: What do we currently capture? What's missing?

---

### Question 4: Is the Current Span Hierarchy Useful?

**Current hierarchy**:
```
pi:session
  └─ pi:user_interaction
      ├─ pi:user_message
      └─ pi:agent_run
          ├─ pi:turn (newly added)
          │   ├─ pi:tool:bash
          │   └─ pi:assistant_response
```

**Questions**:
1. Does `pi:turn` add value or complexity?
2. Is `pi:user_interaction` useful or just another layer?
3. Is `pi:agent_run` capturing meaningful data?
4. Are we missing spans for key operations?

**Recommendation**: Simplify or restructure?

---

### Question 5: What Spans Do We Actually Need?

**Proposed minimal set** (for auditable log):

| Span Type | Purpose | Critical Data |
|-----------|---------|---------------|
| `pi:session` | Session boundary | Start/end time, session type (interactive/batch) |
| `pi:user_request` | What user asked | Request text, attachments, context |
| `pi:file_read` | Files read | Path, lines read, why? |
| `pi:file_write` | Files written | Path, diff, backup created? |
| `pi:file_edit` | Files edited | Path, edit blocks, success/fail |
| `pi:command_run` | Commands executed | Command, cwd, exit code, output |
| `pi:tool_result` | Tool outcomes | Success, error message, result |
| `pi:agent_response` | Agent output | Response text, tokens |
| `pi:task_complete` | Task outcome | Success, summary, files changed |

**Compare**: What do we have vs what we need?

---

### Question 6: What Hooks Are We Missing?

**Current hooks instrumented**: 15

**Missing hooks that might matter**:
- `session_before_switch` - When pi switches sessions
- `session_before_fork` - Before forking a session
- `session_before_compact` - Before context compaction
- `context` - Context changes
- `tool_call` - Before tool execution (can block/modify)
- `before_provider_request` - Raw LLM payloads
- `model_select` - Model switches
- `resources_discover` - Files/skills discovered

**Question**: Which of these would help with auditing?

---

### Question 7: Data Quality Issues

**Audit current span payloads**:

1. **pi:agent_run** - Currently captures `{messageCount: 0}`
   - What should it capture? (model config, system prompt hash, tokens?)

2. **pi:turn** - Currently captures `{turnIndex, model}`
   - Is this useful or noise?
   - What would make it valuable?

3. **pi:tool:bash** - Captures `{command, exitCode, stdout}`
   - Missing: cwd, duration, stderr
   - Is this enough to understand what happened?

4. **pi:tool:read** - Captures `{path, contentLength}`
   - Missing: why was it read? what was the content?
   - Should we capture content (or hash)?

5. **pi:tool:write** - Captures `{path, contentLength, created}`
   - Missing: what was written? diff from previous?
   - Should we capture content (or hash)?

6. **pi:tool:edit** - Captures `{path, editCount}`
   - Missing: what edits? success/fail per edit?
   - Critical for understanding agent behavior

**Document**: What data quality issues did you find?

---

### Question 8: Team Sharing Requirements

**For sharing with team**, you'd need:

1. **Session summary** - What was accomplished?
2. **File changes** - What code was modified?
3. **Key decisions** - Why did agent make certain choices?
4. **Issues encountered** - What went wrong?
5. **Time/cost** - How long, how many tokens?

**Current state**: Can Prefactor show this?
- Session summary? ❓
- File changes? ❌ (no diffs)
- Key decisions? ❓ (thinking spans?)
- Issues? ❓ (tool failures captured?)
- Time/cost? ❓ (token tracking?)

**Document**: What's missing for team sharing?

---

## Deliverables

### 1. Gap Analysis Document

Create `GAP-ANALYSIS.md` with:

```markdown
# Gap Analysis: Pi-Prefactor Extension

## What We Have
[List current span types and what they capture]

## What We Need
[For each core requirement, list what's missing]

## Critical Gaps
[Top 5-10 gaps that block core requirements]

## Nice-to-Have
[Features that would be valuable but not critical]

## Recommendations
[What to build, what to remove, what to improve]
```

---

### 2. Span Payload Recommendations

For each span type, document:

```markdown
## pi:agent_run

**Current**: `{messageCount: 0}`

**Should Capture**:
- model: string (which model was used)
- systemPromptHash: string (which instructions)
- temperature: number (config)
- totalTokens: {input, output} (cost tracking)
- durationMs: number (performance)
- success: boolean (outcome)
- filesModified: string[] (what changed)

**Priority**: HIGH
```

---

### 3. Hook Priority List

Rank hooks by importance:

```markdown
## Critical (Must Have)
1. session_start - Session boundary
2. user_request - What user asked
3. tool_execution_start - What agent is doing
4. tool_result - What happened
5. session_shutdown - Session complete

## Important (Should Have)
6. before_agent_start - Agent config
7. agent_end - Agent outcome
8. file operations - Code changes

## Nice-to-Have (Could Have)
9. turn_start/turn_end - Multi-turn tracking
10. thinking - Agent reasoning
11. model_select - Model switches

## Skip (Won't Have)
- turn spans (too granular, not enough value)
- user_interaction (adds complexity, no value)
```

---

### 4. Implementation Plan

Based on assessment, create prioritized plan:

```markdown
## Phase 1: Critical Fixes (This Week)
1. Fix pi:agent_run payload (capture meaningful data)
2. Add file change tracking (what files modified)
3. Add outcome tracking (success/fail per task)
4. Remove turn spans (if not valuable)

## Phase 2: Important Improvements (Next Week)
5. Add token tracking
6. Add duration tracking
7. Improve tool payloads (stderr, cwd, etc.)

## Phase 3: Enhancements (Future)
8. Circuit breaker (if API reliability is issue)
9. Team sharing features
10. Session summaries
```

---

## Testing Your Recommendations

After creating the analysis:

1. **Implement top 3 critical fixes**
2. **Run a real coding session** with the extension
3. **Query Prefactor** and try to answer:
   - What files were modified?
   - What commands were run?
   - Did anything fail?
   - How long did it take?
   - Would a team member understand what happened?

4. **Validate**: Can you now answer the questions from Question 2?

---

## Success Criteria

Your assessment is complete when:

- [ ] Gap analysis document created
- [ ] Span payload recommendations documented
- [ ] Hook priority list created
- [ ] Implementation plan prioritized
- [ ] Top 3 critical fixes implemented
- [ ] Validated with real coding session
- [ ] Can answer: "What did the agent do?" from Prefactor alone

---

## Important Notes

**Be Critical**:
- Don't defend what we've built
- Question every span type
- Remove features that don't add value
- Focus on core requirements (auditable log, assessment, sharing)

**Be Practical**:
- What can we implement in 1-2 weeks?
- What's essential vs. nice-to-have?
- What data is actually useful vs. noise?

**Be Honest**:
- If turn spans don't add value, say so
- If we're capturing useless data, document it
- If we need to restructure, recommend it

---

**Start by querying Prefactor to see what we currently capture, then work through each question systematically.**
