# Pi-Prefactor Extension: Overview

**Version**: 1.0  
**Date**: 2026-04-13  
**Status**: Production Ready  

---

## Executive Summary

The Pi-Prefactor Extension instruments the Pi coding agent to capture detailed session data and submit it to the Prefactor observability system. This enables developers and teams to review, analyze, and share AI-assisted coding sessions for improved effectiveness and collaboration.

---

## Business Purpose

### Primary Goal

**Capture an auditable, high-resolution log of Pi agent actions** to enable:

1. **Coding Session Review** - Understand what the agent did, why, and with what outcome
2. **Harness Effectiveness Assessment** - Evaluate how well Pi performs software development tasks
3. **Team Collaboration** - Share agent sessions with team members for knowledge transfer and review

---

## Problem Statement

### Current State

When Pi coding agent completes a task:
- No persistent record of what actions were taken
- No visibility into which files were modified
- No tracking of commands executed or their outcomes
- No way to share sessions with team members
- No way to assess agent effectiveness over time

### Business Impact

**Developers cannot**:
- Review what the agent did after a session ends
- Understand why the agent made certain decisions
- Share successful (or failed) sessions with teammates
- Measure agent productivity or effectiveness
- Identify patterns in agent behavior

**Teams cannot**:
- Onboard new members with real session examples
- Review agent work before accepting changes
- Build institutional knowledge about effective agent usage
- Track ROI of AI-assisted development

---

## Solution

### What the Extension Does

```
┌─────────────────┐
│  Pi Coding      │
│  Agent          │
│                 │
│  ┌───────────┐  │
│  │ Extension │  │
│  │ (This     │  │
│  │ Project)  │  │
│  └─────┬─────┘  │
└────────┼────────┘
         │
         │ Captures:
         │ - User requests
         │ - Tool executions (read, write, edit, bash)
         │ - Agent responses
         │ - Outcomes (success/fail, files changed)
         │ - Performance (duration, tokens)
         │
         ▼
┌─────────────────┐
│  Prefactor      │
│  Observability  │
│  System         │
│                 │
│  ┌───────────┐  │
│  │ Query &   │  │
│  │ Review    │  │
│  └───────────┘  │
└─────────────────┘
```

### Key Capabilities

**For Individual Developers**:
- Review completed sessions to understand what changed
- Debug agent behavior when something goes wrong
- Track time and token usage per session
- Build personal knowledge base of effective prompts

**For Teams**:
- Share sessions demonstrating best practices
- Review agent work before merging changes
- Onboard new members with real examples
- Measure team-wide agent effectiveness

**For Engineering Leadership**:
- Assess ROI of AI-assisted development
- Identify patterns in successful vs. failed sessions
- Make data-driven decisions about AI tooling

---

## Requirements

### Must Have (P0 - Core Requirements)

These capabilities are **essential** and non-negotiable:

#### 1. Complete Action Audit Trail

**Requirement**: Capture every significant action the agent takes.

**Includes**:
- User request (what was asked)
- Files read (with paths)
- Files written/created (with paths)
- Files edited (with paths and edit count)
- Commands executed (with full command, working directory, exit code, output)
- Agent responses (what the agent said to the user)

**Success Criteria**:
- Can reconstruct "what happened" from Prefactor data alone
- No significant actions missing from the log

---

#### 2. Outcome Tracking

**Requirement**: Capture whether each operation and the overall session succeeded or failed.

**Includes**:
- Per-tool success/fail status
- Error messages when operations fail
- Overall session success/fail
- Reason for session completion (completed, error, cancelled, etc.)

**Success Criteria**:
- Can identify failed operations and understand why
- Can distinguish successful sessions from failed ones

---

#### 3. Session Metadata

**Requirement**: Capture essential context about each session.

**Includes**:
- Which LLM model was used
- What the user requested (original prompt)
- Session start/end timestamps
- Session duration
- Which tools/skills were available

**Success Criteria**:
- Can answer "which model?", "what was asked?", "how long did it take?"
- Can filter/search sessions by model, time period, etc.

---

#### 4. File Change Tracking

**Requirement**: Track which files were modified during the session.

**Includes**:
- Files read (paths)
- Files created (paths)
- Files modified (paths)
- Distinguishing between create vs. update operations

**Success Criteria**:
- Can list all files touched by a session
- Can identify new files vs. modified files

---

#### 5. Clean Data Model

**Requirement**: Captured data must be meaningful and queryable.

**Includes**:
- No redundant fields (every field must have unique value)
- No fixed-value fields (fields that are always the same provide no signal)
- Consistent field names and semantics
- Proper parent-child relationships between spans

**Success Criteria**:
- Payload sizes are reasonable (no unnecessary data)
- Every field answers a specific question
- Can query Prefactor for meaningful patterns

---

### Should Have (P1 - Important Enhancements)

These capabilities add significant value but are not blocking:

#### 1. Token Usage Tracking

**Requirement**: Capture token consumption for cost tracking.

**Includes**:
- Input tokens per session
- Output tokens per session
- Total tokens
- Per-operation token breakdown (if available)

**Value**: Enables cost analysis and optimization.

---

#### 2. Agent Reasoning Capture

**Requirement**: Capture agent's thinking/reasoning when available.

**Includes**:
- Agent's thought process before actions
- Decision rationale
- Alternative options considered

**Value**: Enables understanding of "why" the agent made certain choices.

---

#### 3. Session Summaries

**Requirement**: Generate human-readable session summaries.

**Includes**:
- Auto-generated summary of what was accomplished
- Key decisions made
- Files changed summary

**Value**: Quick understanding without reviewing all details.

---

#### 4. Performance Metrics

**Requirement**: Track performance beyond basic duration.

**Includes**:
- Per-operation duration
- Time breakdown by operation type
- Bottleneck identification

**Value**: Identify slow operations and optimize.

---

### Nice to Have (P2 - Future Enhancements)

These capabilities would be valuable but are lower priority:

#### 1. Code Quality Signals

**Examples**:
- Test results (pass/fail counts)
- Lint errors detected
- Build success/fail
- Lines added/removed

---

#### 2. Advanced Analytics

**Examples**:
- Session similarity detection
- Pattern recognition across sessions
- Automated effectiveness scoring
- Trend analysis over time

---

#### 3. Integration Features

**Examples**:
- Export sessions to external formats
- Integration with issue trackers
- Linking sessions to PRs/commits
- Slack/Teams notifications

---

#### 4. Real-time Features

**Examples**:
- Live session monitoring
- Anomaly detection during execution
- Intervention triggers (e.g., alert on expensive operations)

---

## Out of Scope

The following are explicitly **not** goals of this extension:

### ❌ Not a Pi Feature Extension

This extension does **not** add new capabilities to Pi itself. It only observes and reports on existing Pi behavior.

### ❌ Not a Session Management Tool

This extension does **not** control Pi sessions, manage context, or influence agent behavior.

### ❌ Not a Code Review Tool

While captured data can inform code review, this extension does **not** perform code review or quality assessment.

### ❌ Not a Security Tool

This extension does **not** audit for security issues, scan for vulnerabilities, or enforce security policies.

---

## Success Metrics

### Adoption Metrics

- **Sessions Captured**: Number of Pi sessions with complete span data
- **Active Users**: Number of developers using Prefactor to review sessions
- **Shared Sessions**: Number of sessions shared with team members

### Quality Metrics

- **Data Completeness**: % of sessions with all required fields populated
- **Query Success**: % of user queries that return meaningful results
- **User Satisfaction**: Developer feedback on session review experience

### Business Metrics

- **Time to Understand**: Reduction in time to understand what agent did
- **Team Alignment**: Improvement in shared understanding of agent behavior
- **Effectiveness Insights**: Number of actionable insights about agent performance

---

## Technical Approach

### Architecture

**Extension Type**: Pi coding agent extension (TypeScript)

**Integration Point**: Pi hook system (session, tool, message lifecycle events)

**Data Flow**:
1. Pi fires lifecycle events (session_start, tool_execution, etc.)
2. Extension captures relevant data from events
3. Extension creates Prefactor spans with structured payloads
4. Prefactor backend stores and indexes span data
5. Users query Prefactor CLI/API to review sessions

### Data Model

**Core Entity**: Agent Span

Each span represents a discrete unit of agent activity:
- `pi:session` - Session lifecycle boundary
- `pi:user_message` - User request
- `pi:agent_run` - Agent execution context
- `pi:tool:*` - Tool executions (read, write, edit, bash)
- `pi:assistant_response` - Agent response to user
- `pi:agent_thinking` - Agent thinking / reasoning 

**Relationships**: Parent-child hierarchy enables drill-down from session to individual operations.

### Deployment

**Runtime**: Node.js 22+ (via Bun)

**Configuration**: Environment variables for Prefactor API credentials

**Distribution**: Pi extension package (npm)

---

## Risks and Mitigations

### Risk: Pi API Limitations

**Description**: Pi may not expose all desired data (e.g., system prompt, skills list).

**Mitigation**: 
- Capture what's available now
- Design schema to accommodate future Pi API enhancements
- Document gaps clearly

---

### Risk: Data Privacy

**Description**: Captured data may include sensitive information (file paths, code, commands).

**Mitigation**:
- Document what data is captured
- Provide configuration options for data capture limits
- Recommend appropriate Prefactor access controls

---

### Risk: Performance Impact

**Description**: Extension overhead may slow down Pi sessions.

**Mitigation**:
- Minimize synchronous operations
- Batch span creation where possible
- Monitor and benchmark performance impact

---

### Risk: Data Overload

**Description**: Too much captured data makes review difficult.

**Mitigation**:
- Focus on high-signal data (remove noise fields)
- Provide query tools for filtering/searching
- Enable session summaries for quick review

---

## Stakeholders

### Primary Users

- **Developers using Pi** - Review their own sessions
- **Tech Leads** - Review team member sessions, assess effectiveness
- **Engineering Managers** - Track adoption and ROI

### Secondary Users

- **New Team Members** - Learn from example sessions
- **AI/ML Team** - Analyze agent behavior patterns
- **DevEx Team** - Improve developer experience with AI tools

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| pi-coding-agent/docs | Official documentation for the pi-coding-agent |
| ../cli | Prefactor CLI documentation |
| [prefactor-api](https://app.prefactorai.com/api/v1/openapi) | Prefactor API documentation |

---

## Conclusion

The Pi-Prefactor Extension provides essential observability for AI-assisted development. By capturing detailed session data and enabling review through Prefactor, it empowers developers and teams to understand, assess, and improve their use of AI coding assistants.
