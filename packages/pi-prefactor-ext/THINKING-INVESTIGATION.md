# Thinking Capture Investigation

**Date**: 2026-04-13  
**Status**: Root Cause Identified

---

## Problem

No `pi:agent_thinking` spans are being created, even though the schema was added in P0 fixes.

---

## Root Cause

### 1. Model Doesn't Output Structured Thinking

**Finding**: The qwen3.5:cloud model (via Ollama) outputs thinking as **formatted text within the response content**, not as a separate `event.message.thinking` field.

**Evidence**:
```
turn_end_debug:
  hasMessage: true
  hasThinking: false
  thinkingType: undefined
  thinkingPreview: N/A
  contentPreview: array
```

**Current Code** (expects structured thinking):
```typescript
if (event.message?.thinking) {
  const thinking = typeof event.message.thinking === 'string'
    ? event.message.thinking
    : '';
  
  if (thinking) {
    await sessionManager.createAgentThinkingSpan(...);
  }
}
```

**Reality**: `event.message.thinking` is always `undefined` for this model.

---

### 2. Race Condition: Tool Span Created After Result

**Finding**: Tool result arrives before span is created.

**Evidence**:
```
[pi-prefactor:tool_execution_start] toolCallId=call_ftw9gik6
[pi-prefactor:tool_result] toolCallId=call_ftw9gik6
[pi-prefactor:tool_call_span_not_found] toolCallId=call_ftw9gik6  ← ERROR
[pi-prefactor:span_created] schemaName=pi:tool_call  ← Created too late!
```

**Root Cause**: `tool_execution_start` creates span, but async operation completes before span creation finishes.

---

## Solutions

### Solution 1: Parse Thinking from Content (Quick Fix)

Extract thinking from formatted content when `event.message.thinking` is missing:

```typescript
pi.on("turn_end", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  
  // Try structured thinking first
  let thinking = '';
  if (event.message?.thinking && typeof event.message.thinking === 'string') {
    thinking = event.message.thinking;
  } else {
    // Fallback: Extract thinking from content (models that output thinking as text)
    const content = event.message?.content;
    if (Array.isArray(content)) {
      const textBlocks = content
        .filter(block => block?.type === 'text')
        .map(block => block.text)
        .join('\n');
      
      // Look for thinking patterns (common in reasoning models)
      const thinkingMatch = textBlocks.match(/^(Let me work through.*?)(?=\n\n\*\*Answer|\*\*Final Answer|$)/s);
      if (thinkingMatch) {
        thinking = thinkingMatch[1].trim();
      }
    }
  }
  
  if (thinking) {
    await sessionManager.createAgentThinkingSpan(
      sessionKey,
      thinking,
      event.usage ? {
        input: event.usage.inputTokens,
        output: event.usage.outputTokens,
      } : undefined,
      {
        provider: (ctx.model as any)?.provider,
        model: (ctx.model as any)?.id,
      }
    );
  }
  
  // ... rest of handler
});
```

**Pros**: 
- Works with models that output thinking as text
- Backward compatible with structured thinking

**Cons**:
- Heuristic-based (may miss some thinking patterns)
- Adds parsing overhead

---

### Solution 2: Fix Tool Span Race Condition

**Current Flow**:
```
tool_execution_start → createSpan (async) → tool_result (arrives before span created)
```

**Fix**: Create span synchronously or wait for completion:

```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  
  logger.info('tool_execution_start', {
    sessionKey,
    toolName: event.toolName,
    toolCallId: event.toolCallId,
  });
  
  const payload: Record<string, unknown> = {
    toolName: event.toolName,
    toolCallId: event.toolCallId,
  };
  
  if (config.captureToolInputs) {
    payload.input = event.args;
  }
  
  // CRITICAL: Await span creation before returning
  await sessionManager.createToolCallSpan(sessionKey, event.toolName, payload);
  
  // Ensure span is created before tool executes
  logger.debug('tool_span_creation_complete', {
    sessionKey,
    toolCallId: event.toolCallId,
  });
});
```

**Alternative**: Use a Map to track pending tool calls:

```typescript
// In session-state.ts
private pendingToolSpans: Map<string, Promise<string | null>> = new Map();

async createToolCallSpan(...): Promise<string | null> {
  const spanPromise = this.agent.createSpan(...);
  this.pendingToolSpans.set(toolCallId, spanPromise);
  return spanPromise;
}

async closeToolCallSpanWithResult(...): Promise<void> {
  // Wait for span creation if pending
  const spanPromise = this.pendingToolSpans.get(toolCallId);
  if (spanPromise) {
    const spanId = await spanPromise;
    this.pendingToolSpans.delete(toolCallId);
    // ... finish span
  }
}
```

---

### Solution 3: Add `before_provider_request` Hook (Future)

Capture LLM request/response payloads to extract thinking from raw API responses.

**Implementation**:
```typescript
pi.on("before_provider_request", async (event, ctx) => {
  logger.debug('before_provider_request', {
    provider: event.provider,
    model: event.model,
    messageCount: event.payload.messages?.length,
  });
});
```

This would help debug what's actually sent to/received from the model.

---

## Recommended Action Plan

### Immediate (Today)

1. **Fix tool span race condition** (Solution 2)
   - Critical bug causing lost tool spans
   - ~30 minutes

2. **Add thinking extraction from content** (Solution 1)
   - Enables thinking capture for text-based reasoning models
   - ~1 hour

### Short Term (This Week)

3. **Test with different models**
   - Try Claude, GPT-4, or other models with structured thinking
   - Verify `event.message.thinking` field exists

4. **Add `before_provider_request` hook**
   - Better debugging visibility
   - ~30 minutes

---

## Test Commands

### Test Thinking Capture

```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
source .env
export PREFACTOR_LOG_LEVEL=debug

# Test with thinking prompt
pi -p -e ./src/index.ts "What is 2+2? Think through this step by step." 2>&1 | grep -E "thinking|turn_end_debug"
```

### Test Tool Span Fix

```bash
# Test with tool call
pi -p -e ./src/index.ts "List files in current directory" 2>&1 | grep -E "tool_call_span|tool_result"
```

### Verify in Prefactor

```bash
cd /home/sprite/typescript-sdk/packages/cli
./dist/bin/cli.js agent_spans list --agent_instance_id <INSTANCE_ID> --start_time <START> --end_time <END> | jq '.summaries[] | {schema_name, id}'
```

---

## Current Span Output (Without Fixes)

```
pi:session
  └─ pi:user_interaction
      ├─ pi:user_message
      └─ pi:agent_run
          ├─ pi:tool_call (sometimes missing due to race condition)
          └─ pi:assistant_response (contains thinking as text, not separate span)
```

## Expected Span Output (After Fixes)

```
pi:session
  └─ pi:user_interaction
      ├─ pi:user_message
      └─ pi:agent_run
          ├─ pi:agent_thinking (extracted from content or structured field)
          ├─ pi:tool_call (reliably created)
          └─ pi:assistant_response (response text only)
```

---

## Notes

- **Model Dependency**: Thinking capture is model-dependent. Some models (Claude, some GPT-4 variants) output structured thinking, others (qwen3.5:cloud) output thinking as formatted text.
- **Heuristic Limitations**: Text-based thinking extraction will never be 100% reliable.
- **Best Long-term Solution**: Use models with native structured thinking support when thinking capture is critical.
