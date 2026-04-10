# Tasks for Pi Agent - MVP Gaps Implementation

**Session**: pi-mvp-work (tmux)  
**Date**: 2026-04-09  
**Goal**: Implement high-priority MVP gaps

---

## Priority 1: Thinking Capture (1 hour)

### Task 1.1: Add thinking span to session-state.ts

**File**: `packages/pi-prefactor-ext/src/session-state.ts`

Add method:
```typescript
async createAgentThinkingSpan(
  sessionKey: string,
  thinking: string,
  tokens?: { input?: number; output?: number },
  metadata?: { provider?: string; model?: string }
): Promise<string | null>
```

**Acceptance criteria**:
- Method creates `pi:agent_thinking` span
- Span is child of `agentRunSpanId`
- Thinking content truncated to `maxInputLength`
- Logs span creation

### Task 1.2: Update index.ts to capture thinking

**File**: `packages/pi-prefactor-ext/src/index.ts`

In `turn_end` handler:
```typescript
// Capture thinking if enabled and present
if (config.captureThinking && event.message?.thinking) {
  const thinking = typeof event.message.thinking === 'string'
    ? event.message.thinking
    : '';
  
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
}
```

**Acceptance criteria**:
- Thinking captured from `event.message.thinking`
- Only captured if `config.captureThinking` is true
- Logs thinking span creation

### Task 1.3: Test thinking capture

**Command**:
```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
export PREFACTOR_API_TOKEN=your-token
export PREFACTOR_AGENT_ID=your-agent-id
pi -e ./src/index.ts
```

**Verify**:
- Ask pi to "think step by step" about a problem
- Check logs for `thinking_span_created`
- Verify span appears in Prefactor UI

---

## Priority 2: Documentation (1-2 hours)

### Task 2.1: Update README.md

**File**: `packages/pi-prefactor-ext/README.md`

Sections to add:
1. Quick Start (env vars, installation)
2. Configuration (all options with defaults)
3. Span Hierarchy (diagram)
4. Commands (/prefactor-config)
5. Troubleshooting

**Acceptance criteria**:
- User can follow Quick Start to get running
- All config options documented
- Troubleshooting covers common issues

### Task 2.2: Create EXAMPLES.md

**File**: `packages/pi-prefactor-ext/EXAMPLES.md`

Examples:
1. Basic setup with env vars
2. Setup with package config
3. Verifying spans in Prefactor UI
4. Debugging with /prefactor-config

---

## Priority 3: Turn Tracking (2 hours)

### Task 3.1: Add turn state to session-state.ts

**File**: `packages/pi-prefactor-ext/src/session-state.ts`

Add to `SessionSpanState`:
```typescript
currentTurnIndex: number;
turnSpanIds: Map<number, string>;
```

Add methods:
- `createTurnSpan(sessionKey, turnIndex, payload)`
- `closeTurnSpan(sessionKey, turnIndex, status)`

### Task 3.2: Add turn_start hook to index.ts

**File**: `packages/pi-prefactor-ext/src/index.ts`

```typescript
pi.on("turn_start", async (event, ctx) => {
  const sessionKey = getSessionKey(ctx);
  await sessionManager.createTurnSpan(sessionKey, event.turnIndex, {
    turnIndex: event.turnIndex,
  });
});
```

### Task 3.3: Update turn_end to close turn span

**File**: `packages/pi-prefactor-ext/src/index.ts`

At end of `turn_end` handler:
```typescript
await sessionManager.closeTurnSpan(sessionKey, event.turnIndex);
```

---

## Priority 4: Additional Hooks (2 hours)

### Task 4.1: Add remaining hooks to index.ts

Add these hooks (15 min each):

1. `context` - Log message modifications
2. `model_select` - Track model switches
3. `resources_discover` - Log resource loading
4. `session_before_switch` - Track session switches
5. `session_before_compact` - Track compaction start
6. `session_compact` - Track compaction end
7. `tool_execution_update` - Log streaming updates
8. `tool_execution_end` - Fallback for tool_result
9. `message_update` - Log streaming deltas

**Acceptance criteria**:
- All hooks log with sessionKey
- No span creation (just logging for now)
- Consistent format with existing hooks

---

## Testing Checklist

After each task:
- [ ] Run `pi -e ./src/index.ts`
- [ ] Verify no TypeScript errors
- [ ] Check logs for expected output
- [ ] Test with real Prefactor credentials (if available)

---

## Commit Strategy

After completing each priority:
1. Thinking capture → commit
2. Documentation → commit
3. Turn tracking → commit
4. Additional hooks → commit

**Commit format**:
```
feat: Add thinking block capture

- Add createAgentThinkingSpan to session-state.ts
- Update turn_end handler to capture thinking
- Respect config.captureThinking flag
- Truncate thinking to maxInputLength
```

---

## Progress Tracking

- [ ] Task 1.1: Add thinking span method
- [ ] Task 1.2: Update turn_end handler
- [ ] Task 1.3: Test thinking capture
- [ ] Task 2.1: Update README.md
- [ ] Task 2.2: Create EXAMPLES.md
- [ ] Task 3.1: Add turn state tracking
- [ ] Task 3.2: Add turn_start hook
- [ ] Task 3.3: Update turn_end to close span
- [ ] Task 4.1: Add 9 additional hooks

---

## Notes

- Work in tmux session: `pi-mvp-work`
- Attach: `tmux attach -t pi-mvp-work`
- Detach: Ctrl+B, then D
- Kill session: `tmux kill-session -t pi-mvp-work`
