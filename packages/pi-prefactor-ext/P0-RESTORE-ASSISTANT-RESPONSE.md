# P0 Restore: Assistant Response Spans

**Priority**: P0 CRITICAL - REGRESSION FIX  
**Date**: 2026-04-13  
**Status**: Ready for immediate implementation  

---

## Problem

In P0-CLEANUP we removed `pi:assistant_response` spans, thinking they were redundant.

**This was a mistake.**

### What We Lost

From live session data, we CANNOT answer:

| Question | Before Cleanup | After Cleanup |
|----------|----------------|---------------|
| What did agent say? | ✅ Yes (assistant_response.text) | ❌ **NO** |
| What did agent think? | ✅ Yes (if thinking enabled) | ❌ **NO** |
| What was the response? | ✅ Yes | ❌ **NO** |

### Current Span Hierarchy (Incomplete)

```
pi:session
  └─ pi:user_message          ← What user asked
      └─ pi:agent_run         ← Agent execution
          └─ pi:tool:bash     ← Actions taken
          └─ pi:tool:write    ← Files changed
```

**Missing**: What the agent **said** in response!

### Correct Span Hierarchy

```
pi:session
  └─ pi:user_message          ← What user asked
      └─ pi:agent_run         ← Agent execution
          ├─ pi:tool:bash     ← Actions taken
          ├─ pi:tool:write    ← Files changed
          └─ pi:assistant_response  ← What agent said + thought ✅
```

---

## Why Assistant Response is Essential

### 1. Conversation Audit Trail

**Without**: You see tools ran, but don't know what agent told the user.

**Example**:
- Tools: `write file.txt`, `bash git commit`
- **Missing**: Did agent explain what it did? Did it warn about issues?

### 2. Debugging Agent Behavior

**Without**: Can't tell if agent misunderstood the request.

**Example**:
- User: "Create a test file"
- Agent: "I'll create a production file instead" ← **This is critical!**
- Tools: writes production file

**Without assistant_response**: Looks like agent did wrong thing.  
**With assistant_response**: Can see agent misunderstood.

### 3. Thinking/Reasoning Capture

If agent has thinking/reasoning enabled:

```
pi:assistant_response
  - thinking: "User wants test file, should create in tests/ directory..."
  - text: "I'll create the test file in tests/"
```

**This is debugging gold** - shows agent's reasoning process.

### 4. Team Sharing

When sharing sessions with team:

**Without**: "Agent ran these tools"  
**With**: "Agent said it would do X, then did Y" ← **Much more context!**

---

## Implementation Plan

### Task 1: Restore pi:assistant_response Schema

**File**: `src/agent.ts`

```typescript
{
  name: 'pi:assistant_response',
  description: 'Assistant response message to user',
  template: '{{ text | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Response text to user' },
      model: { type: 'string', description: 'Model used for response' },
      provider: { type: 'string', description: 'Provider used' },
      startTime: { type: 'number', description: 'Start timestamp (ms)' },
      // Optional thinking/reasoning
      thinking?: { type: 'string', description: 'Agent thinking/reasoning (if enabled)' },
      tokens?: {
        type: 'object',
        properties: {
          input: { type: 'number' },
          output: { type: 'number' },
          total: { type: 'number' },
        },
      },
    },
    required: ['text', 'startTime'],
  },
  result_schema: {
    type: 'object',
    properties: {
      endTime: { type: 'number', description: 'End timestamp (ms)' },
      durationMs: { type: 'number', description: 'Response duration' },
      isError: { type: 'boolean', description: 'Whether response failed' },
    },
    required: ['endTime', 'isError'],
  },
}
```

---

### Task 2: Capture Assistant Response

**File**: `src/index.ts` (agent_end handler or message_end handler)

```typescript
pi.on("agent_end", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) return;
  
  const endTime = Date.now();
  const state = sessionManager.getSessionState(sessionKey);
  
  // Extract assistant response from event
  const responseText = event.response?.text || event.result?.text || '';
  const thinking = (event as any)?.thinking || (event as any)?.reasoning || '';
  
  logger.debug('agent_end', {
    sessionKey,
    success: event.success,
    hasResponse: !!responseText,
    hasThinking: !!thinking,
  });
  
  // Create assistant_response span as child of agent_run
  const parentSpanId = state?.agentRunSpanId;
  
  if (responseText || thinking) {
    await sessionManager.createAssistantResponseSpan(sessionKey, {
      text: responseText,
      thinking: thinking || undefined,
      model: ctx.model?.id,
      provider: ctx.model?.provider,
      startTime: endTime,  // Response happens at end
    }, parentSpanId);
    
    await sessionManager.closeAssistantResponseSpan(sessionKey, {
      endTime: Date.now(),
      durationMs: Date.now() - endTime,
      isError: false,
    });
  }
  
  // ... rest of agent_end handler
});
```

---

### Task 3: Add to Session State

**File**: `src/session-state.ts`

```typescript
interface SessionSpanState {
  // ... existing fields
  
  // Assistant response tracking
  assistantResponseSpanId: string | null;
}

// Initialize in getOrCreateSessionState
assistantResponseSpanId: null,

// Methods to implement
async createAssistantResponseSpan(
  sessionKey: string,
  payload: Record<string, unknown>,
  parentSpanId: string | null
): Promise<string> {
  const state = this.sessions.get(sessionKey);
  if (!state || !this.agent) throw new Error('Session not initialized');
  
  const spanId = await this.agent.createSpan(
    sessionKey,
    'pi:assistant_response',
    payload,
    parentSpanId
  );
  
  state.assistantResponseSpanId = spanId;
  this.logger.debug('assistant_response_span_created', {
    sessionKey,
    spanId,
    parentSpanId,
  });
  
  return spanId;
}

async closeAssistantResponseSpan(
  sessionKey: string,
  resultPayload: Record<string, unknown>,
  isError: boolean = false
): Promise<void> {
  const state = this.sessions.get(sessionKey);
  if (!state || !this.agent) return;
  
  const spanId = state.assistantResponseSpanId;
  if (!spanId) {
    this.logger.warn('assistant_response_close_no_span', { sessionKey });
    return;
  }
  
  const status = isError ? 'failed' : 'complete';
  const finalPayload = { ...resultPayload };
  
  this.logger.debug('assistant_response_closing', {
    sessionKey,
    spanId,
    status,
  });
  
  await this.agent.finishSpan(sessionKey, spanId, status, finalPayload);
  
  state.assistantResponseSpanId = null;
  this.logger.debug('assistant_response_span_closed', {
    sessionKey,
    spanId,
    status,
  });
}
```

---

### Task 4: Also Capture in message_end Hook

**Alternative/Additional**: Capture response in `message_end` hook

```typescript
pi.on("message_end", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!sessionKey) return;
  
  const responseText = event.text || '';
  const thinking = (event as any)?.thinking || '';
  
  logger.debug('message_end', {
    sessionKey,
    hasResponse: !!responseText,
    hasThinking: !!thinking,
  });
  
  // Get agent_run as parent
  const state = sessionManager.getSessionState(sessionKey);
  const parentSpanId = state?.agentRunSpanId;
  
  if (responseText) {
    const startTime = Date.now();
    await sessionManager.createAssistantResponseSpan(sessionKey, {
      text: responseText,
      thinking: thinking || undefined,
      model: ctx.model?.id,
      provider: ctx.model?.provider,
      startTime,
    }, parentSpanId);
    
    await sessionManager.closeAssistantResponseSpan(sessionKey, {
      endTime: Date.now(),
      durationMs: Date.now() - startTime,
      isError: false,
    });
  }
});
```

---

## Testing

### Test 1: Assistant Response Captured

**Command**:
```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
timeout 30 pi -p -e ./src/index.ts "Say hello and explain what you're doing" 2>&1
```

**Verify**:
```bash
cd /home/sprite/typescript-sdk/packages/cli
INSTANCE_ID=$(bun ./dist/bin/cli.js agent_instances list --agent_id $PREFACTOR_AGENT_ID | jq -r '.summaries[0].id')
START="2026-04-13T00:00:00Z"
END="2026-04-13T23:59:59Z"

bun ./dist/bin/cli.js agent_spans list \
  --agent_instance_id "$INSTANCE_ID" \
  --start_time "$START" \
  --end_time "$END" \
  | jq '.summaries[] | select(.schema_name == "pi:assistant_response") | {payload: .payload, result_payload: .result_payload}'
```

**Expected**:
```json
{
  "payload": {
    "text": "Hello! I'm here to help you...",
    "model": "qwen3.5:cloud",
    "provider": "ollama",
    "startTime": 1776059776920
  },
  "result_payload": {
    "endTime": 1776059776950,
    "durationMs": 30,
    "isError": false
  }
}
```

**Acceptance**:
- ✅ pi:assistant_response span exists
- ✅ text field contains response
- ✅ model/provider captured
- ✅ duration tracked

---

### Test 2: Thinking Captured (If Enabled)

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries[] | select(.schema_name == "pi:assistant_response") | .payload.thinking'
```

**Expected** (if thinking enabled):
```json
"User wants me to say hello, I should be friendly and offer help..."
```

**Acceptance**:
- ✅ thinking field present (if agent has thinking)
- ✅ Contains reasoning process

---

### Test 3: Span Hierarchy Correct

**Verify**:
```bash
bun ./dist/bin/cli.js agent_spans list ... \
  | jq '.summaries | map({schema: .schema_name, parent: .parent_span_id})'
```

**Expected hierarchy**:
```
pi:session (no parent)
  └─ pi:user_message (parent: session)
      └─ pi:agent_run (no parent or parent: user_message)
          ├─ pi:tool:* (parent: agent_run)
          └─ pi:assistant_response (parent: agent_run) ← NEW!
```

**Acceptance**:
- ✅ assistant_response is child of agent_run
- ✅ Hierarchy is clean and logical

---

## Success Criteria

**Restore is complete when**:

1. ✅ pi:assistant_response schema registered
2. ✅ Response text captured in span
3. ✅ Thinking captured (if available)
4. ✅ Model/provider captured
5. ✅ Duration tracked
6. ✅ Span hierarchy correct (child of agent_run)
7. ✅ Can answer "What did agent say?" from Prefactor
8. ✅ TypeScript compilation passes
9. ✅ Validated with real session

---

## Why This is P0 (Not P1)

**This is a REGRESSION**, not a new feature:

1. **Blocking core requirement**: "Auditable log of agent actions"
   - Agent **saying** something is an action!
   
2. **Debugging impossible without it**: Can't tell if agent misunderstood

3. **Team sharing crippled**: "Agent ran tools" vs "Agent said X, then did Y"

4. **User explicitly requested**: "these are non-negotiable"

---

## Implementation Checklist

- [ ] Add pi:assistant_response schema to agent.ts
- [ ] Add assistantResponseSpanId to SessionSpanState
- [ ] Implement createAssistantResponseSpan method
- [ ] Implement closeAssistantResponseSpan method
- [ ] Capture response in agent_end or message_end handler
- [ ] Capture thinking if available
- [ ] Build extension
- [ ] Test with real session
- [ ] Verify span hierarchy correct
- [ ] Commit with validation

---

**Ready for immediate implementation. This is a critical regression fix.**
