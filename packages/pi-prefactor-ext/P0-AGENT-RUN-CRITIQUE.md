# Critical Analysis: agent_run Span Payload

**Date**: 2026-04-13  
**Status**: Questioning current approach  

---

## Current State

From instance `01kp2m7k6b4x99bmj3bydx3kfqssfsaq`:

```json
{
  "payload": {
    "messageCount": 0,
    "model": "qwen3.5:cloud",
    "provider": "ollama",
    "startTime": 1776057308820,
    "systemPromptHash": "013246c67e2e27c9"
  },
  "result_payload": {
    "commandsRun": 1,
    "durationMs": 19357,
    "endTime": 1776057328177,
    "filesCreated": [],
    "filesModified": ["/home/sprite/.../cleanup-test.txt"],
    "filesRead": [],
    "reason": "failed",  // ← BUG: contradicts success:true
    "success": true,
    "toolCalls": 3
  }
}
```

---

## Critical Question: What's Actually Valuable?

### Can Be Derived From Child Spans ❌

| Field | Why Redundant |
|-------|---------------|
| `startTime` | Earliest child span timestamp |
| `endTime` | Latest child span timestamp |
| `durationMs` | Calculated from timestamps |
| `filesModified` | Query `pi:tool:write` + `pi:tool:edit` spans |
| `filesCreated` | Query `pi:tool:write` spans where `created=true` |
| `filesRead` | Query `pi:tool:read` spans |
| `commandsRun` | Count `pi:tool:bash` spans |
| `toolCalls` | Count all `pi:tool:*` spans |

**Conclusion**: ~70% of current payload is **redundant aggregation**.

---

### Cannot Be Derived From Child Spans ✅

| Field | Why Essential |
|-------|---------------|
| `model` | Which LLM was used (not in child spans) |
| `provider` | Which provider (ollama, openai, etc.) |
| `systemPrompt` | Agent instructions (critical for debugging!) |
| `temperature` | Model config (affects behavior) |
| `success` | Overall session outcome |
| `error` | What went wrong (if failed) |
| `reason` | Why session ended |
| `tokens` | Token usage (cost tracking) |

**Conclusion**: ~30% is **truly unique value**.

---

## The Real Problem: systemPromptHash

**Current**: `"systemPromptHash": "013246c67e2e27c9"`

**Problem**: A hash tells you NOTHING without a lookup table.

**Questions**:
1. Which skills were loaded?
2. What instructions did the agent have?
3. What tools were available?
4. What was the agent's goal?

**Hash is useless for**:
- Debugging: "Why did the agent do X?" → Need actual prompt
- Sharing: "What instructions was it following?" → Hash doesn't help
- Evaluation: "Did it follow instructions?" → Can't verify with hash

---

## What Should agent_run Capture?

### For Agent Debugging

**Must have**:
```typescript
{
  // Agent configuration (CANNOT derive from children)
  model: string,           // Which LLM
  provider: string,        // Which provider
  temperature?: number,    // Model config
  systemPrompt: string,    // ACTUAL PROMPT, not hash!
  skillsLoaded: string[],  // Which skills active
  toolsAvailable: string[], // Which tools available
  
  // Session outcome (CANNOT derive from children)
  success: boolean,        // Did it succeed?
  error?: string,          // What went wrong?
  terminationReason: string, // Why ended (success/error/user_cancel/etc)
  
  // Token usage (CANNOT derive from children)
  tokens?: {
    input: number,
    output: number,
    total: number
  }
}
```

**Nice to have**:
```typescript
{
  // Session metadata
  sessionId: string,       // Correlation ID
  sessionType: 'interactive' | 'batch',
  
  // Performance (could derive, but convenient)
  durationMs: number,
  turnCount: number,       // How many LLM calls
}
```

---

### For Code Session Evaluation

**Must have**:
```typescript
{
  // What changed
  filesModified: string[],  // Convenience (could query children)
  linesChanged?: {          // Would need diff tracking
    added: number,
    removed: number
  },
  
  // Quality signals
  testsRun?: number,        // If test tool was used
  testsPassed?: number,
  lintErrors?: number,
  
  // Cost
  tokens: { input, output, total },
  estimatedCost?: number,   // If pricing known
}
```

---

### For Team Sharing

**Must have**:
```typescript
{
  // Human-readable summary
  summary: string,          // What was accomplished
  userRequest: string,      // Original ask
  
  // Key outcomes
  filesModified: string[],  // What changed
  commandsRun: string[],    // What was executed
  
  // Outcome
  success: boolean,
  error?: string,
  
  // Metadata for context
  model: string,
  durationMs: number,
  timestamp: string,
}
```

---

## Proposed Minimal agent_run Payload

**Payload (start)**:
```typescript
{
  // Agent configuration - CANNOT derive from children
  model: string,
  provider: string,
  temperature?: number,
  systemPrompt: string,    // FULL PROMPT or meaningful excerpt
  skillsLoaded: string[],
  toolsAvailable: string[],
  
  // Session metadata
  sessionId: string,
  sessionType: 'interactive' | 'batch',
  userRequest?: string,    // First user message
  
  // Timing
  startTime: number,
}
```

**Result Payload (end)**:
```typescript
{
  // Outcome - CANNOT derive from children
  success: boolean,
  error?: string,
  terminationReason: 'completed' | 'error' | 'user_cancel' | 'timeout',
  
  // Token usage - CANNOT derive from children
  tokens?: {
    input: number,
    output: number,
    total: number
  },
  
  // Convenience aggregations (could derive, but useful)
  filesModified: string[],
  filesCreated: string[],
  commandsRun: number,
  toolCalls: number,
  turnCount: number,
  
  // Timing
  endTime: number,
  durationMs: number,
  
  // Human-readable summary
  summary?: string,        // Auto-generated or agent-provided
}
```

---

## Critical Issues to Fix

### 1. systemPromptHash → systemPrompt

**Current**: `"systemPromptHash": "013246c67e2e27c9"`

**Problem**: Useless without lookup table.

**Fix**: Capture actual system prompt or meaningful excerpt:
```typescript
// In before_agent_start handler
const systemPrompt = ctx.systemPrompt || '';
await sessionManager.createAgentRunSpan(sessionKey, {
  systemPrompt: systemPrompt.slice(0, config.maxSystemPromptLength),  // e.g., 2000 chars
  systemPromptHash: createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16),  // Keep hash for dedup
});
```

---

### 2. reason: "failed" but success: true

**Current**: 
```json
{
  "reason": "failed",
  "success": true
}
```

**Problem**: Contradictory!

**Fix**: Use consistent termination reasons:
```typescript
terminationReason: 'completed' | 'error' | 'user_cancel' | 'timeout' | 'session_shutdown'
```

**Logic**:
```typescript
if (event.success) {
  terminationReason = 'completed';
} else if (event.error) {
  terminationReason = 'error';
} else {
  terminationReason = 'session_shutdown';  // Clean shutdown
}
```

---

### 3. messageCount: 0

**Current**: `"messageCount": 0`

**Problem**: Always zero, not capturing actual count.

**Fix**: Capture from event or track in session state:
```typescript
// In before_agent_start
const messageCount = event.messages?.length || 0;
await sessionManager.createAgentRunSpan(sessionKey, {
  messageCount,
});
```

---

### 4. Missing Token Tracking

**Current**: No token tracking anywhere.

**Problem**: Cannot answer "How much did this cost?"

**Fix**: Capture from provider response:
```typescript
// In tool_result or agent_end handler
const usage = event.usage || (event.result as any)?.usage;
if (usage) {
  resultPayload.tokens = {
    input: usage.promptTokens || usage.input_tokens,
    output: usage.completionTokens || usage.output_tokens,
    total: usage.totalTokens || (usage.promptTokens + usage.completionTokens),
  };
}
```

---

## Recommendation: Two-Phase Approach

### Phase 1: Fix Critical Gaps (This Week)

1. **Capture systemPrompt** (not just hash)
2. **Fix terminationReason** (consistent values)
3. **Fix messageCount** (actual count)
4. **Add token tracking** (cost visibility)
5. **Add skillsLoaded** (which instructions active)

### Phase 2: Remove Redundancy (Next Week)

**Question**: Should we REMOVE redundant fields from agent_run?

**Options**:

**Option A: Keep Aggregations** (Current approach)
```typescript
// Keep filesModified, commandsRun, etc. in agent_run
// Pros: Convenient, single query for summary
// Cons: Redundant, more data to maintain
```

**Option B: Remove Aggregations** (Minimalist)
```typescript
// Remove filesModified, commandsRun, toolCalls from agent_run
// Query child spans for details
// Pros: Less redundancy, single source of truth
// Cons: More complex queries for summaries
```

**Recommendation**: **Option A** for now - keep aggregations for convenience, but mark them as "derived" in documentation. Can optimize later.

---

## Success Criteria

**agent_run is valuable when**:

1. ✅ Can answer "Which model was used?" → `model` field
2. ✅ Can answer "What instructions?" → `systemPrompt` field (not hash!)
3. ✅ Can answer "Did it succeed?" → `success` + `terminationReason`
4. ✅ Can answer "What went wrong?" → `error` field
5. ✅ Can answer "How much did it cost?" → `tokens` field
6. ✅ Can answer "What skills were active?" → `skillsLoaded` field
7. ✅ Can answer "What did user ask?" → `userRequest` field
8. ✅ NO contradictory data (reason vs success)
9. ✅ NO always-zero fields (messageCount)
10. ✅ NO redundant data that could be child spans

---

## Next Steps

1. **Read this critique** and discuss: What's actually valuable?
2. **Implement Phase 1 fixes** (systemPrompt, tokens, terminationReason, etc.)
3. **Validate**: Can you debug a session from agent_run + child spans?
4. **Consider Phase 2**: Remove redundant aggregations?

---

**Key insight**: agent_run should capture what CANNOT be derived from children, plus convenient aggregations. Currently it has too much redundancy and misses critical fields like systemPrompt and tokens.
