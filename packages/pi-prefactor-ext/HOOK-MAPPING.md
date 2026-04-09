# Hook Implementation Reference

Quick reference for implementing each hook handler. Shows the exact event data available and what span operations to perform.

---

## Session Lifecycle

### `session_start`

**When**: Session created, loaded, or reloaded

**Event**:
```typescript
{
  reason: "startup" | "reload" | "new" | "resume" | "fork",
  previousSessionFile?: string
}
```

**Context**: `ctx.sessionManager`, `ctx.ui`, `ctx.cwd`

**Implementation**:
```typescript
pi.on("session_start", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? `ephemeral-${Date.now()}`;
  
  logger.info('session_start', { 
    reason: event.reason, 
    sessionKey,
    previousSession: event.previousSessionFile 
  });
  
  // Create root session span
  await sessionManager.createSessionSpan(sessionKey);
});
```

---

### `session_shutdown`

**When**: Session ending (switch, fork, quit)

**Event**: `{}` (empty)

**Context**: `ctx.sessionManager`

**Implementation**:
```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  
  logger.info('session_shutdown', { sessionKey });
  
  // Close all spans for this session
  await sessionManager.closeSessionSpan(sessionKey);
});
```

---

### `session_before_switch`

**When**: Before `/new` or `/resume`

**Event**:
```typescript
{
  reason: "new" | "resume",
  targetSessionFile?: string  // only for "resume"
}
```

**Return**: `{ cancel: true }` to abort

**Implementation**:
```typescript
pi.on("session_before_switch", async (event, ctx) => {
  logger.info('session_before_switch', { 
    reason: event.reason,
    target: event.targetSessionFile 
  });
  // Optionally confirm or track
});
```

---

### `session_before_compact` / `session_compact`

**When**: Manual or automatic compaction

**Event** (`before_compact`):
```typescript
{
  preparation: { firstKeptEntryId, tokensBefore, ... },
  customInstructions?: string,
  signal: AbortSignal
}
```

**Return**: `{ cancel: true }` or `{ compaction: { summary, firstKeptEntryId, tokensBefore } }`

**Implementation**:
```typescript
pi.on("session_before_compact", async (event, ctx) => {
  logger.info('session_before_compact', {
    tokensBefore: event.preparation.tokensBefore,
    firstKept: event.preparation.firstKeptEntryId
  });
});

pi.on("session_compact", async (event, ctx) => {
  logger.info('session_compact', {
    fromExtension: event.fromExtension
  });
});
```

---

## Agent Lifecycle

### `before_agent_start`

**When**: Before agent processes user prompt

**Event**:
```typescript
{
  messages: AgentMessage[],
  // ... other fields
}
```

**Context**: `ctx.sessionManager`, `ctx.model`, `ctx.tools`

**Implementation**:
```typescript
pi.on("before_agent_start", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  
  // Create user message span if we have pending message
  if (pendingUserMessage) {
    await sessionManager.createUserMessageSpan(sessionKey, {
      text: pendingUserMessage.text,
      timestamp: pendingUserMessage.timestamp,
    });
    pendingUserMessage = null;
  }
  
  // Start agent run span
  await sessionManager.createAgentRunSpan(sessionKey, {
    messageCount: event.messages?.length || 0,
  });
  
  logger.info('before_agent_start', {
    sessionKey,
    messageCount: event.messages?.length
  });
});
```

---

### `agent_start` / `agent_end`

**When**: Agent execution boundaries

**Event** (`agent_end`):
```typescript
{
  messages: AgentMessage[],
  success: boolean,
  durationMs?: number
}
```

**Implementation**:
```typescript
pi.on("agent_start", async (_event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  logger.info('agent_start', { sessionKey });
});

pi.on("agent_end", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  
  logger.info('agent_end', {
    sessionKey,
    success: event.success,
    durationMs: event.durationMs
  });
  
  // Close agent run span
  await sessionManager.closeAgentRunSpan(
    sessionKey, 
    event.success ? 'complete' : 'failed'
  );
});
```

---

### `turn_start` / `turn_end`

**When**: Each LLM response cycle (agent may have multiple turns)

**Event** (`turn_end`):
```typescript
{
  message?: AgentMessage,  // Assistant response
  toolResults: ToolResult[],
  usage?: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}
```

**Implementation**:
```typescript
pi.on("turn_start", async (_event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  logger.debug('turn_start', { sessionKey });
});

pi.on("turn_end", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  
  // Extract thinking content
  if (event.message?.thinking && typeof event.message.thinking === 'string') {
    await sessionManager.createAgentThinkingSpan(
      sessionKey,
      event.message.thinking,
      event.usage,
      {
        provider: ctx.model?.provider,
        model: ctx.model?.id,
      }
    );
  }
  
  // Extract assistant response text
  const text = extractTextFromContent(event.message?.content);
  await sessionManager.createAssistantResponseSpan(
    sessionKey,
    text,
    event.usage,
    {
      provider: ctx.model?.provider,
      model: ctx.model?.id,
    }
  );
  
  logger.info('turn_end', {
    sessionKey,
    hasMessage: !!event.message,
    toolResultsCount: event.toolResults?.length
  });
});
```

---

## Tool Lifecycle

### `tool_call`

**When**: Before tool execution (can block or modify input)

**Event**:
```typescript
{
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>,  // MUTABLE
  // ... other fields
}
```

**Context**: `ctx.sessionManager`, `ctx.tools`

**Return**: `{ block: true, reason?: string }` to block

**Implementation**:
```typescript
pi.on("tool_call", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  
  logger.info('tool_call', {
    sessionKey,
    tool: event.toolName,
    toolCallId: event.toolCallId,
  });
  
  // Create tool call span
  await sessionManager.createToolCallSpan(sessionKey, event.toolName, {
    input: event.input,
    toolCallId: event.toolCallId,
  });
  
  // Example: block dangerous commands
  // if (event.toolName === 'bash' && event.input.command?.includes('rm -rf')) {
  //   const ok = await ctx.ui.confirm('Dangerous!', 'Allow rm -rf?');
  //   if (!ok) return { block: true, reason: 'Blocked by user' };
  // }
});
```

---

### `tool_result`

**When**: After tool execution (can modify result)

**Event**:
```typescript
{
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>,
  result?: {
    content: ContentBlock[],
    details?: Record<string, unknown>,
    isError?: boolean
  },
  durationMs?: number
}
```

**Return**: Modified result or `{ block: true }`

**Implementation**:
```typescript
pi.on("tool_result", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  
  const resultText = extractTextFromContent(event.result?.content);
  const isError = event.result?.isError ?? false;
  
  logger.info('tool_result', {
    sessionKey,
    tool: event.toolName,
    toolCallId: event.toolCallId,
    isError,
    durationMs: event.durationMs
  });
  
  // Close tool call span with result
  await sessionManager.closeToolCallSpanWithResult(
    sessionKey,
    event.toolCallId,
    event.toolName,
    resultText,
    isError
  );
});
```

---

### `tool_execution_start` / `tool_execution_update` / `tool_execution_end`

**When**: Streaming tool execution events

**Event** (`tool_execution_end`):
```typescript
{
  toolName: string,
  toolCallId: string,
  result?: ToolResult
}
```

**Implementation**:
```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  logger.debug('tool_execution_start', {
    tool: event.toolName,
    toolCallId: event.toolCallId
  });
});

pi.on("tool_execution_update", async (event, ctx) => {
  logger.debug('tool_execution_update', {
    tool: event.toolName,
    hasOutput: !!event.output
  });
});

pi.on("tool_execution_end", async (event, ctx) => {
  logger.debug('tool_execution_end', {
    tool: event.toolName,
    toolCallId: event.toolCallId
  });
});
```

---

## Message Lifecycle

### `input`

**When**: User sends input (before skill/template expansion)

**Event**:
```typescript
{
  text: string
}
```

**Context**: `ctx.sessionManager`, `ctx.ui`

**Implementation**:
```typescript
pi.on("input", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  
  // Store pending message for agent_start
  pendingUserMessage = {
    text: event.text,
    timestamp: Date.now(),
  };
  
  // Ensure interaction span exists
  await sessionManager.createOrGetInteractionSpan(sessionKey);
  
  logger.info('input', {
    sessionKey,
    textPreview: event.text.slice(0, 100)
  });
});
```

---

### `message_start` / `message_update` / `message_end`

**When**: Message streaming (user, assistant, tool results)

**Event** (`message_start`):
```typescript
{
  message: AgentMessage
}
```

**Event** (`message_update`):
```typescript
{
  type: "text_delta" | "thinking_delta",
  delta: string
}
```

**Implementation**:
```typescript
pi.on("message_start", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  logger.debug('message_start', {
    sessionKey,
    role: event.message.role
  });
});

pi.on("message_update", async (event, ctx) => {
  // Stream updates could be captured here if needed
});

pi.on("message_end", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  logger.debug('message_end', {
    sessionKey,
    role: event.message.role
  });
});
```

---

## Provider/Model

### `before_provider_request`

**When**: Before sending request to LLM provider

**Event**:
```typescript
{
  provider: string,
  model: string,
  payload: Record<string, unknown>,  // MUTABLE
  // ... other fields
}
```

**Implementation**:
```typescript
pi.on("before_provider_request", async (event, ctx) => {
  const sessionKey = ctx.sessionManager.getSessionFile() ?? 'ephemeral';
  
  logger.info('before_provider_request', {
    sessionKey,
    provider: event.provider,
    model: event.model,
    hasMessages: Array.isArray(event.payload.messages),
    messageCount: Array.isArray(event.payload.messages) 
      ? event.payload.messages.length 
      : 0
  });
  
  // Could capture LLM input here if needed
});
```

---

### `model_select`

**When**: User changes model

**Event**:
```typescript
{
  model: Model,
  thinkingLevel?: ThinkingLevel
}
```

**Implementation**:
```typescript
pi.on("model_select", async (event, ctx) => {
  logger.info('model_select', {
    provider: event.model.provider,
    modelId: event.model.id,
    thinkingLevel: event.thinkingLevel
  });
});
```

---

## Resources

### `resources_discover`

**When**: After session start, extensions can contribute resources

**Event**:
```typescript
{
  cwd: string,
  reason: "startup" | "reload"
}
```

**Return**: `{ skillPaths, promptPaths, themePaths }`

**Implementation**:
```typescript
pi.on("resources_discover", async (event, ctx) => {
  logger.info('resources_discover', {
    cwd: event.cwd,
    reason: event.reason
  });
  // Could contribute custom skills/prompts here
});
```

---

## Helper Functions

### Extract Text from Content

```typescript
function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  
  if (!Array.isArray(content)) {
    return '';
  }
  
  const textParts: string[] = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    }
  }
  
  return textParts.join('\n');
}
```

### Get Session Key

```typescript
function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionFile() ?? `ephemeral-${Date.now()}`;
}
```

---

## Complete Hook Registration Summary

```typescript
// Session (4 hooks)
pi.on("session_start", handler);
pi.on("session_shutdown", handler);
pi.on("session_before_switch", handler);
pi.on("session_before_compact", handler);
pi.on("session_compact", handler);

// Agent (6 hooks)
pi.on("before_agent_start", handler);
pi.on("agent_start", handler);
pi.on("agent_end", handler);
pi.on("turn_start", handler);
pi.on("turn_end", handler);
pi.on("context", handler);

// Tools (6 hooks)
pi.on("tool_call", handler);
pi.on("tool_result", handler);
pi.on("tool_execution_start", handler);
pi.on("tool_execution_update", handler);
pi.on("tool_execution_end", handler);

// Messages (4 hooks)
pi.on("input", handler);
pi.on("message_start", handler);
pi.on("message_update", handler);
pi.on("message_end", handler);

// Provider/Model (2 hooks)
pi.on("before_provider_request", handler);
pi.on("model_select", handler);

// Resources (1 hook)
pi.on("resources_discover", handler);

// Total: ~23 hooks
```
