# Critical Review: Pi Prefactor Extension

**Date**: 2026-04-13  
**Status**: MVP Complete → Production Readiness Review  
**Reviewer**: AI Assistant

---

## Executive Summary

The pi-prefactor extension MVP successfully instruments 11 pi hooks to create distributed tracing spans. The implementation is functional and validated (see `DEBUGGING-AND-VALIDATION-GUIDE.md`), but has **7 critical issues** that must be addressed before production use.

**Key Finding**: The extension captures basic span hierarchy but misses high-value telemetry that would make Prefactor indispensable for pi users tracking coding sessions.

---

## 1. Span Hierarchy Analysis

### Current Hierarchy (MVP)

```
pi:session (root, 24hr)
  └─ pi:user_interaction (5min idle timeout)
      ├─ pi:user_message (user input)
      ├─ pi:agent_run (agent execution)
      │   └─ pi:tool_call (tool executions)
      └─ pi:assistant_response (LLM response)
      └─ pi:agent_thinking (UNREGISTERED - BUG!)
```

### Issues

#### ❌ Issue 1.1: Unregistered Span Type

**Problem**: `pi:agent_thinking` spans are created in `session-state.ts` but NOT registered in `agent.ts` schema.

**Location**: 
- `src/agent.ts` lines 156-200 (schema registration)
- `src/session-state.ts` lines 214-235 (thinking span creation)

**Impact**: Prefactor backend rejects spans with unknown schema_name, causing silent data loss.

**Fix Required**:
```typescript
// In src/agent.ts agentSchemaVersion.span_type_schemas
{
  name: 'pi:agent_thinking',
  description: 'Agent reasoning/thinking content',
  template: '{{ thinking | default: "(thinking captured)" | truncate: 200 }}',
  params_schema: {
    type: 'object',
    properties: {
      thinking: { type: 'string', description: 'Thinking content' },
      tokens: { 
        type: 'object',
        description: 'Token usage during thinking',
      },
      provider: { type: 'string', description: 'Model provider' },
      model: { type: 'string', description: 'Model ID' },
    },
  },
}
```

---

#### ❌ Issue 1.2: Missing Turn Spans

**Problem**: Multi-turn agent runs (LLM → tools → LLM → tools) are not tracked as individual spans.

**Evidence**: `MVP-GAPS.md` Gap 1, `PLAN-v2.md` section 3

**Impact**: Cannot debug why agent took multiple iterations. High-value for understanding agent behavior.

**Example Scenario**:
```
User: "Refactor this function"
Turn 1: Agent calls read tool
Turn 2: Agent calls edit tool  
Turn 3: Agent responds with summary
```

Current: All 3 turns lumped into single `pi:agent_run`  
Expected: Each turn as `pi:turn` child of agent_run

**Fix Required**: Add turn span tracking (detailed plan in `MVP-GAPS.md`)

---

#### ⚠️ Issue 1.3: Assistant Response Parent Ambiguity

**Problem**: Assistant response spans are children of `interactionSpanId`, not `agentRunSpanId`.

**Location**: `src/session-state.ts` line 196

**Current**:
```typescript
const spanId = await this.agent.createSpan(
  sessionKey,
  'pi:assistant_response',
  payload,
  state.interactionSpanId  // ← Parent is interaction
);
```

**Question**: Should assistant response be sibling of agent_run (current) or child of agent_run?

**Recommendation**: Make it a **child of agent_run** for clearer hierarchy:
```
pi:user_interaction
  └─ pi:user_message
  └─ pi:agent_run
      ├─ pi:turn (future)
      │   └─ pi:assistant_response
      └─ pi:tool_call
```

**Rationale**: Assistant response is output of agent execution, not independent interaction.

---

## 2. Data Attachment Analysis

### Current Payload Coverage

| Span Type | Captured Data | Missing High-Value Data |
|-----------|---------------|------------------------|
| `pi:session` | `createdAt` | Session file path, reason (startup/reload/fork) |
| `pi:user_interaction` | `startedAt` | Interaction count, idle duration |
| `pi:user_message` | `text`, `timestamp` | Source (interactive/skill), image count, attachments |
| `pi:agent_run` | `messageCount` | System prompt hash, model config, temperature |
| `pi:tool_call` | `toolName`, `toolCallId`, `input` (optional) | **Tool-specific schemas**, duration, error details |
| `pi:assistant_response` | `text`, `tokens`, `provider`, `model` | **Finish reason**, logprobs, safety ratings |
| `pi:agent_thinking` | `thinking`, `tokens`, `provider`, `model` | **Thinking depth**, signature, time spent |

---

#### ❌ Issue 2.1: Generic Tool Schemas

**Problem**: All tools use generic `pi:tool_call` schema instead of tool-specific schemas.

**Location**: `src/index.ts` lines 223-238

**Current**:
```typescript
await sessionManager.createToolCallSpan(sessionKey, event.toolName, {
  toolName: event.toolName,
  toolCallId: event.toolCallId,
  input: event.args,  // Optional based on config
});
```

**Impact**: 
- Prefactor cannot validate tool-specific payloads
- No tool-specific UI templates
- Cannot query "show all bash commands" or "show all file reads"

**High-Value Tool Schemas to Add**:

```typescript
// pi:tool:bash
{
  command: string,      // The bash command
  timeout?: number,     // Timeout in ms
  cwd?: string,         // Working directory
  exitCode?: number,    // Result (on finish)
  stdout?: string,      // Output (truncated)
  stderr?: string,      // Errors (truncated)
  durationMs?: number   // Execution time
}

// pi:tool:read
{
  path: string,         // File path
  offset?: number,      // Start line
  limit?: number,       // Max lines
  contentLength?: number,  // Bytes read
  encoding?: string     // File encoding
}

// pi:tool:write
{
  path: string,         // File path
  contentLength: number,  // Bytes written
  created: boolean,     // New file or update
  backupPath?: string   // If backup created
}

// pi:tool:edit
{
  path: string,         // File path
  editCount: number,    // Number of edit blocks
  oldTextHashes: string[],  // Hashes of replaced text
  newTextLengths: number[], // Lengths of replacements
  successCount: number  // Successful edits
}
```

**Recommendation**: Implement tool-specific schemas from `MVP-GAPS.md` Gap 3.

---

#### ❌ Issue 2.2: Missing Token Usage on Key Spans

**Problem**: Token usage is captured inconsistently.

**Evidence**: 
- `turn_end` event has `event.usage` (line 175 in index.ts)
- But `agent_run` span doesn't capture cumulative tokens
- `session` span doesn't track session-level token totals

**Impact**: Cannot answer:
- "How many tokens did this coding session consume?"
- "Which agent runs were most expensive?"
- "What's my token burn rate per hour?"

**Recommendation**: Add token aggregation:
```typescript
// In session-state.ts
interface SessionSpanState {
  // ... existing
  totalInputTokens: number;
  totalOutputTokens: number;
}

// In turn_end handler (index.ts)
if (event.usage) {
  state.totalInputTokens += event.usage.inputTokens;
  state.totalOutputTokens += event.usage.outputTokens;
  
  // Update session span with running total
  await sessionManager.updateSessionSpan(sessionKey, {
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
  });
}
```

---

#### ⚠️ Issue 2.3: Configuration Fields Referenced But Not Defined

**Problem**: `getConfigSummary` references fields that don't exist in schema.

**Location**: `src/config.ts` lines 132-152

**Code**:
```typescript
export function getConfigSummary(config: PrefactorConfig): Record<string, unknown> {
  return {
    // ...
    captureThinking: config.captureThinking,      // ← NOT IN SCHEMA
    captureToolInputs: config.captureToolInputs,  // ← NOT IN SCHEMA
    captureToolOutputs: config.captureToolOutputs, // ← NOT IN SCHEMA
    // ...
  };
}
```

**Impact**: TypeScript error (if strict), runtime undefined values, misleading logs.

**Fix**: Either add to schema or remove from summary:
```typescript
// Option 1: Add to schema (recommended)
captureThinking: z.boolean().default(true),
captureToolInputs: z.boolean().default(true),
captureToolOutputs: z.boolean().default(true),

// Option 2: Remove from summary (quick fix)
// Delete lines 145-147 in config.ts
```

---

## 3. Hook Coverage Analysis

### Current Hook Coverage: 11 of 23 Available

| Category | Available Hooks | Implemented | Coverage |
|----------|----------------|-------------|----------|
| **Session** | 6 (`session_start`, `session_shutdown`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`) | 2 | 33% |
| **Agent** | 6 (`before_agent_start`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `context`) | 3 | 50% |
| **Tools** | 5 (`tool_execution_start`, `tool_call`, `tool_execution_update`, `tool_result`, `tool_execution_end`) | 2 | 40% |
| **Messages** | 4 (`input`, `message_start`, `message_update`, `message_end`) | 3 | 75% |
| **Provider/Model** | 2 (`before_provider_request`, `model_select`) | 0 | 0% |
| **Resources** | 1 (`resources_discover`) | 0 | 0% |

---

#### ❌ Issue 3.1: Missing High-Value Hooks

**Critical Missing Hooks**:

1. **`turn_start`** (15 min effort)
   - Why: Track turn boundaries for multi-turn debugging
   - Data: `turnIndex`, model at turn time
   
2. **`before_provider_request`** (30 min effort)
   - Why: Capture exact LLM payloads (messages, system prompt, params)
   - Data: Provider, model, message count, system prompt hash
   - Note: Add `captureProviderPayloads` config flag (default: false)

3. **`model_select`** (15 min effort)
   - Why: Track model switches during session
   - Data: Previous model, new model, thinking level, trigger reason

4. **`tool_call`** (15 min effort)
   - Why: Can block/modify tool input before execution
   - Use case: Security auditing, input validation

**Recommendation**: Implement in priority order above. Total effort: ~1.5 hours.

---

#### ⚠️ Issue 3.2: Hook Handler Inconsistency

**Problem**: Some hooks log at `info` level, others at `debug` with no clear pattern.

**Examples**:
```typescript
// Info level (good for production monitoring)
logger.info('session_start', { ... });
logger.info('input', { ... });
logger.info('tool_execution_start', { ... });

// Debug level (hidden in default config)
logger.debug('message_start', { ... });
logger.debug('message_end', { ... });
```

**Impact**: Inconsistent observability. Hard to debug message flow.

**Recommendation**: Standardize logging levels:
- `info`: Lifecycle events (session/agent/turn/tool start/end)
- `debug`: Streaming updates, message deltas
- `warn`: Recoverable errors (span not found, retry queued)
- `error`: Unrecoverable errors (API failures, config invalid)

---

## 4. Error Handling & Resilience

### Current Error Handling

**Strengths**:
- ✅ Retry queue for failed API operations (`agent.ts` lines 69-97)
- ✅ Graceful degradation if agent is null (`session-state.ts` checks)
- ✅ Idempotency keys for all API operations
- ✅ Background flush loop for retry queue (30s interval)

---

#### ❌ Issue 4.1: Silent Span Creation Failures

**Problem**: `createSpan` returns `null` on failure but callers don't check.

**Location**: `src/agent.ts` lines 327-367

**Code**:
```typescript
async createSpan(...): Promise<string | null> {
  // ...
  if (!session.instanceId) {
    this.logger.error('cannot_create_span_no_instance_id', { sessionKey });
    return null;  // ← Returns null
  }
  // ...
  const spanId = response.details?.id;
  if (!spanId) {
    this.logger.error('create_span_no_id', { sessionKey, schemaName });
    return null;  // ← Returns null
  }
  return spanId;
}
```

**Caller Example** (`session-state.ts` line 77):
```typescript
const spanId = await this.agent.createSpan(...);
if (spanId) {
  state.sessionSpanId = spanId;  // ✓ Checks null
}
// But what if spanId is null? No fallback, no warning to user
```

**Impact**: Silent data loss. User thinks tracing is working but spans are missing.

**Recommendation**: Add circuit breaker pattern:
```typescript
// In agent.ts
private consecutiveFailures = 0;
private circuitOpen = false;

async createSpan(...): Promise<string | null> {
  if (this.circuitOpen) {
    this.logger.warn('circuit_open', { sessionKey, schemaName });
    return null;
  }
  
  try {
    const spanId = await this.doCreateSpan(...);
    this.consecutiveFailures = 0;  // Reset on success
    return spanId;
  } catch (err) {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 5) {
      this.circuitOpen = true;
      this.logger.error('circuit_breaker_opened', { 
        failures: this.consecutiveFailures 
      });
    }
    throw err;  // Let caller handle
  }
}
```

---

#### ⚠️ Issue 4.2: No Health Check or Status Command

**Problem**: No way to verify extension is healthy at runtime.

**Current**: `/prefactor-config` shows config but not runtime status.

**Missing**:
- API connectivity status
- Retry queue depth
- Active session count
- Recent span creation success rate
- Last successful API call timestamp

**Recommendation**: Enhance `/prefactor-config` or add `/prefactor-status`:
```typescript
pi.registerCommand('prefactor-status', {
  description: 'Show Prefactor extension runtime status',
  handler: async (_args, ctx) => {
    const status = {
      apiConnected: await agent.healthCheck(),
      retryQueueDepth: agent.getRetryQueueDepth(),
      activeSessions: sessionManager.getActiveSessionCount(),
      spansCreatedLastHour: metrics.spansLastHour,
      lastSuccessfulApiCall: metrics.lastSuccess,
    };
    
    // Display to user
  },
});
```

---

## 5. Configuration & Usability

### Current Configuration

**Strengths**:
- ✅ Environment variable support
- ✅ Package config support
- ✅ Zod validation
- ✅ Sensible defaults

---

#### ❌ Issue 5.1: Missing Critical Config Options

**Missing Config Options**:

1. **`captureThinking`** (boolean, default: true)
   - Why: Users may want to disable thinking capture (privacy, payload size)
   - Referenced in code but not in schema

2. **`captureToolInputs`** (boolean, default: true)
   - Why: Tool inputs may contain secrets (API keys in bash commands)
   - Referenced in code but not in schema

3. **`captureToolOutputs`** (boolean, default: true)
   - Why: Tool outputs may contain sensitive data
   - Referenced in code but not in schema

4. **`samplingRate`** (number, 0-1, default: 1.0)
   - Why: High-volume users may want to sample sessions (e.g., 10%)
   - Critical for cost control at scale

5. **`enabled`** (boolean, default: true)
   - Why: Quick disable without uninstalling extension
   - Use case: Temporarily disable for performance testing

**Recommendation**: Add to `configSchema` in `src/config.ts`:
```typescript
export const configSchema = z.object({
  // ... existing fields
  
  // Capture flags
  captureThinking: z.boolean().default(true),
  captureToolInputs: z.boolean().default(true),
  captureToolOutputs: z.boolean().default(true),
  
  // Sampling
  samplingRate: z.number().min(0).max(1).default(1.0),
  
  // Enable/disable
  enabled: z.boolean().default(true),
});
```

---

#### ⚠️ Issue 5.2: No Payload Size Limits Enforced

**Problem**: Config has `maxInputLength` and `maxOutputLength` but they're not used.

**Location**: `src/config.ts` lines 50-57 (defined)  
**Missing**: Usage in span creation

**Risk**: Large file reads/writes could create huge payloads, causing:
- API request failures
- Slow Prefactor UI
- Storage costs

**Recommendation**: Enforce limits in span creation:
```typescript
// In session-state.ts
import { truncateString } from '@prefactor/core';

async createUserMessageSpan(sessionKey: string, payload: { text: string; ... }) {
  const truncated = truncateString(payload.text, this.config.maxInputLength);
  // ... use truncated
}
```

---

## 6. High-Value Opportunities

These are not bugs but **missed opportunities** to make the extension indispensable.

---

### 🌟 Opportunity 6.1: Session-Level Analytics

**Idea**: Aggregate metrics at session level for productivity insights.

**Data to Track**:
```typescript
interface SessionMetrics {
  // Activity
  userMessageCount: number;
  agentRunCount: number;
  turnCount: number;
  toolCallCount: number;
  
  // Tokens
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCost: number;  // If model pricing known
  
  // Tools
  toolBreakdown: Record<string, number>;  // bash: 5, read: 12, edit: 3
  
  // Time
  sessionDurationMs: number;
  activeTimeMs: number;  // Excluding idle
  avgAgentResponseTimeMs: number;
  
  // Outcomes
  successfulToolCalls: number;
  failedToolCalls: number;
  filesModified: string[];  // From write/edit tools
}
```

**Value**: Users can answer:
- "How productive was my coding session?"
- "Which tools do I use most?"
- "What's my token burn rate?"
- "How long did I spend on this task?"

**Implementation**: Track in `SessionSpanState`, emit on `session_shutdown`.

---

### 🌟 Opportunity 6.2: File Change Tracking

**Idea**: Track which files were modified during session for project context.

**Implementation**:
```typescript
// In tool_result handler for write/edit tools
if (event.toolName === 'write' || event.toolName === 'edit') {
  const filePath = event.input?.path as string;
  if (filePath) {
    sessionState.modifiedFiles.add(filePath);
  }
}

// On session_shutdown, attach to session span
await this.agent.finishSpan(sessionKey, sessionSpanId, 'complete', {
  modifiedFiles: Array.from(sessionState.modifiedFiles),
});
```

**Value**: 
- Prefactor can show "Files changed in this session"
- Enables "show me all sessions that touched file X" queries
- Great for code review context

---

### 🌟 Opportunity 6.3: Error Rate Monitoring

**Idea**: Track tool failure rates and agent failures.

**Implementation**:
```typescript
// In agent_end handler
if (!event.success) {
  logger.warn('agent_failed', { sessionKey });
  // Increment failure counter
}

// In tool_result handler
if (event.isError) {
  logger.warn('tool_failed', { 
    sessionKey, 
    tool: event.toolName,
    toolCallId: event.toolCallId 
  });
  // Increment tool failure counter
}
```

**Value**:
- Alert on high failure rates
- Identify problematic tools
- Debug agent failures

---

### 🌟 Opportunity 6.4: Context Window Tracking

**Idea**: Track context window usage per agent run.

**Implementation**:
```typescript
// In before_provider_request handler
const messageCount = event.payload.messages?.length || 0;
const estimatedTokens = messageCount * 150;  // Rough avg

logger.info('context_usage', {
  sessionKey,
  messageCount,
  estimatedTokens,
  modelContextLimit: ctx.model?.contextWindow || 'unknown',
});
```

**Value**:
- Warn when approaching context limits
- Optimize session compaction timing
- Debug "why did agent forget earlier context?"

---

### 🌟 Opportunity 6.5: Skill/Extension Tracking

**Idea**: Track which pi skills/extensions are used.

**Implementation**:
```typescript
// In resources_discover handler
pi.on("resources_discover", async (event, ctx) => {
  logger.info('session_extensions', {
    sessionKey,
    cwd: event.cwd,
    reason: event.reason,
    // Could return discovered skills/prompts
  });
});

// In tool_execution_start, check if tool is from extension
const isBuiltinTool = ['read', 'write', 'edit', 'bash'].includes(event.toolName);
if (!isBuiltinTool) {
  logger.info('extension_tool_used', {
    sessionKey,
    toolName: event.toolName,
  });
}
```

**Value**:
- Understand extension adoption
- Debug extension tool failures
- Show "extensions used in this session"

---

## 7. Security & Privacy Considerations

### Current State

**Strengths**:
- ✅ API token masked in logs (`***xyz`)
- ✅ Optional tool input/output capture (config flags, though not in schema)

---

#### ⚠️ Issue 7.1: No Secret Redaction

**Problem**: Tool inputs may contain secrets (API keys, passwords) that are captured as-is.

**Example**:
```bash
# User runs:
curl -H "Authorization: Bearer sk-abc123..." https://api.example.com

# Extension captures full command with secret
```

**Recommendation**: Add secret redaction:
```typescript
function redactSecrets(input: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...input };
  
  // Common secret patterns
  const secretPatterns = [
    /Bearer\s+[a-zA-Z0-9\-_]+/gi,
    /api[_-]?key[=:]\s*[a-zA-Z0-9\-_]+/gi,
    /password[=:]\s*[^\s]+/gi,
    /secret[=:]\s*[^\s]+/gi,
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
```

---

#### ⚠️ Issue 7.2: No Data Retention Policy

**Problem**: Spans are sent to Prefactor with no user-configurable retention.

**Risk**: Sensitive coding sessions stored indefinitely.

**Recommendation**: Add retention config:
```typescript
// In config
retentionDays: z.number().positive().default(90)

// On session span creation
await this.agent.createSpan(sessionKey, 'pi:session', {
  createdAt: new Date().toISOString(),
  retentionDays: config.retentionDays,
  // ...
});
```

---

## 8. Performance Considerations

### Current State

**Strengths**:
- ✅ Async span creation (non-blocking)
- ✅ Retry queue with backoff
- ✅ Background flush loop

---

#### ⚠️ Issue 8.1: No Span Creation Rate Limiting

**Problem**: High-frequency tool calls could overwhelm API.

**Scenario**: Agent calls bash tool 50 times in rapid succession → 50 API calls.

**Recommendation**: Add rate limiting:
```typescript
// In agent.ts
private rateLimiter = {
  tokens: 100,
  lastRefill: Date.now(),
  
  async acquire(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefill > 1000) {
      this.tokens = Math.min(100, this.tokens + 10);  // 10 tokens/sec
      this.lastRefill = now;
    }
    
    if (this.tokens <= 0) {
      await sleep(100);  // Wait 100ms
      return this.acquire();
    }
    
    this.tokens--;
  }
};

async createSpan(...) {
  await this.rateLimiter.acquire();
  // ... proceed
}
```

---

#### ⚠️ Issue 8.2: No Payload Compression

**Problem**: Large thinking blocks or tool outputs sent uncompressed.

**Recommendation**: Compress large payloads:
```typescript
// If payload > 10KB, compress
if (JSON.stringify(payload).length > 10000) {
  const compressed = await compress(payload);
  payload = { _compressed: true, data: compressed };
}
```

---

## 9. Testing & Validation

### Current State

**Strengths**:
- ✅ Test harness validates hook firing (`test-harness.ts`)
- ✅ Manual validation with Prefactor CLI
- ✅ Tmux-based parallel testing

---

#### ❌ Issue 9.1: No Automated Tests

**Problem**: No unit or integration tests.

**Evidence**: `MVP-GAPS.md` Gap 7, Gap 8

**Impact**: 
- Hard to catch regressions
- Changes require manual validation
- No CI/CD readiness

**Recommendation**: Add tests (detailed plan in `MVP-GAPS.md`):
```bash
# Directory structure
tests/
  config.test.ts          # Config loading/validation
  session-state.test.ts   # Span hierarchy
  tool-definitions.test.ts # Tool schemas
  logger.test.ts          # Logging
  integration.test.ts     # API integration (requires credentials)
```

---

#### ⚠️ Issue 9.2: No Load Testing

**Problem**: Extension not tested under high load.

**Scenarios to Test**:
- 100 tool calls in 10 seconds
- 10 concurrent sessions
- API unavailable for 5 minutes (retry queue behavior)
- Large payloads (1MB thinking blocks)

**Recommendation**: Add load test script:
```typescript
// tests/load.test.ts
import { describe, test } from 'bun:test';

describe('Load Testing', () => {
  test('100 tool calls in 10 seconds', async () => {
    // Simulate rapid tool calls
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(sessionManager.createToolCallSpan(...));
    }
    await Promise.all(promises);
    // Verify all spans created
  });
});
```

---

## 10. Documentation Gaps

### Current State

**Strengths**:
- ✅ README.md with quick start
- ✅ DEBUGGING-AND-VALIDATION-GUIDE.md (excellent!)
- ✅ PLAN-v2.md with implementation details
- ✅ HOOK-MAPPING.md with hook reference

---

#### ⚠️ Issue 10.1: Missing Troubleshooting Guide

**Problem**: No structured troubleshooting for common issues.

**Recommendation**: Add to README.md:
```markdown
## Troubleshooting

### No spans appearing in Prefactor

1. Check logs: Look for `[pi-prefactor:error]` messages
2. Verify credentials: `/prefactor-config` should show ✅ Valid
3. Test API connectivity: `/prefactor-status` (future command)
4. Check retry queue: Deep queue indicates API issues

### Spans have wrong hierarchy

1. Check session key stability: Should be same across all spans
2. Verify parent span IDs: Use CLI to query spans
3. Check for race conditions: Tool spans before agent_run?

### High API latency

1. Check network connectivity
2. Reduce payload sizes: Disable tool input/output capture
3. Enable sampling: `samplingRate: 0.1` (10% of sessions)
```

---

#### ⚠️ Issue 10.2: No Example Queries

**Problem**: Users don't know how to query their data in Prefactor.

**Recommendation**: Add example queries:
```markdown
## Example Prefactor Queries

### Show all sessions from today
```
SELECT * FROM spans 
WHERE schema_name = 'pi:session' 
AND started_at > '2026-04-13T00:00:00Z'
```

### Show all bash commands executed
```
SELECT payload->>'command' as command 
FROM spans 
WHERE schema_name = 'pi:tool:bash'
```

### Show sessions with failed tool calls
```
SELECT DISTINCT parent_span_id 
FROM spans 
WHERE schema_name = 'pi:tool_call' 
AND result_payload->>'isError' = 'true'
```

### Token usage per session
```
SELECT 
  span_id,
  payload->>'totalInputTokens' as input_tokens,
  payload->>'totalOutputTokens' as output_tokens
FROM spans
WHERE schema_name = 'pi:session'
```
```

---

## Priority Matrix

| Priority | Issue | Effort | Impact | Fix By |
|----------|-------|--------|--------|--------|
| **P0** | 1.1 Unregistered span type (`pi:agent_thinking`) | 15 min | 🔴 Critical | Before next release |
| **P0** | 2.3 Config fields referenced but not defined | 15 min | 🔴 Critical | Before next release |
| **P0** | 5.1 Missing critical config options | 30 min | 🔴 Critical | Before next release |
| **P1** | 1.2 Missing turn spans | 2 hours | 🟠 High | v0.0.2 |
| **P1** | 2.1 Generic tool schemas | 3 hours | 🟠 High | v0.0.2 |
| **P1** | 4.1 Silent span creation failures | 1 hour | 🟠 High | v0.0.2 |
| **P1** | 7.1 No secret redaction | 1 hour | 🟠 High | v0.0.2 |
| **P2** | 1.3 Assistant response parent ambiguity | 15 min | 🟡 Medium | v0.0.2 |
| **P2** | 2.2 Missing token usage on key spans | 1 hour | 🟡 Medium | v0.0.2 |
| **P2** | 3.1 Missing high-value hooks | 1.5 hours | 🟡 Medium | v0.0.3 |
| **P2** | 5.2 No payload size limits enforced | 30 min | 🟡 Medium | v0.0.2 |
| **P2** | 8.1 No rate limiting | 1 hour | 🟡 Medium | v0.0.3 |
| **P3** | 4.2 No health check command | 1 hour | 🟢 Low | v0.0.3 |
| **P3** | 6.x High-value opportunities | 4+ hours | 🟢 Low | Future |
| **P3** | 9.1 No automated tests | 4 hours | 🟢 Low | v0.1.0 |
| **P3** | 10.x Documentation gaps | 2 hours | 🟢 Low | v0.0.2 |

---

## Recommended Action Plan

### Immediate (Before Next Release)

1. **Fix unregistered span type** (Issue 1.1)
   - Add `pi:agent_thinking` to schema in `agent.ts`
   - Test with Prefactor CLI

2. **Fix config schema** (Issue 2.3, 5.1)
   - Add missing fields to `configSchema`
   - Remove or fix `getConfigSummary`

3. **Add payload limits enforcement** (Issue 5.2)
   - Use `maxInputLength` and `maxOutputLength` in span creation

### Short Term (v0.0.2 - 1 week)

4. **Implement turn spans** (Issue 1.2)
   - Add `turn_start` hook
   - Track turns in `SessionSpanState`

5. **Add tool-specific schemas** (Issue 2.1)
   - Create `tool-definitions.ts`
   - Register schemas in `agent.ts`

6. **Add error handling improvements** (Issue 4.1, 7.1)
   - Circuit breaker pattern
   - Secret redaction

### Medium Term (v0.0.3 - 2 weeks)

7. **Add missing hooks** (Issue 3.1)
   - `turn_start`, `before_provider_request`, `model_select`, `tool_call`

8. **Add rate limiting** (Issue 8.1)
   - Token bucket rate limiter

9. **Add health check command** (Issue 4.2)
   - `/prefactor-status`

### Long Term (v0.1.0 - 1 month)

10. **Add automated tests** (Issue 9.1)
    - Unit tests for config, session-state, tools
    - Integration tests (optional, requires credentials)

11. **Implement high-value opportunities** (Issue 6.x)
    - Session analytics
    - File change tracking
    - Error rate monitoring

---

## Conclusion

The pi-prefactor extension MVP is **functional but not production-ready**. The 3 P0 issues must be fixed before any user relies on this for tracking coding sessions.

**Key Strengths**:
- Solid foundation with retry queue and multi-session support
- Excellent debugging documentation
- Validated hook execution order

**Key Weaknesses**:
- Critical bugs (unregistered span types, config mismatches)
- Missing high-value telemetry (turns, tool-specific schemas)
- No error resilience patterns (circuit breaker, rate limiting)

**Recommendation**: Fix P0 issues immediately, then prioritize P1 issues for v0.0.2. The extension has strong potential to become indispensable for pi users, but only if the data captured is accurate, complete, and secure.

---

## Appendix: Code Locations

| Issue | File | Lines |
|-------|------|-------|
| 1.1 Unregistered span type | `src/agent.ts` | 156-200 |
| 1.1 Unregistered span type | `src/session-state.ts` | 214-235 |
| 1.3 Assistant response parent | `src/session-state.ts` | 196 |
| 2.1 Generic tool schemas | `src/index.ts` | 223-238 |
| 2.3 Config fields mismatch | `src/config.ts` | 132-152 |
| 3.1 Missing hooks | `src/index.ts` | (not present) |
| 4.1 Silent failures | `src/agent.ts` | 327-367 |
| 5.1 Missing config options | `src/config.ts` | 23-57 |
| 5.2 Payload limits | `src/config.ts` | 50-57 |

---

## References

- `DEBUGGING-AND-VALIDATION-GUIDE.md` - Testing approach
- `MVP-GAPS.md` - Missing features plan
- `PLAN-v2.md` - Implementation plan
- `HOOK-MAPPING.md` - Hook reference
- `TEST-RESULTS.md` - Validation results
