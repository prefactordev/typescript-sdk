# Phase 4: Production Hardening & Feature Completeness

**Date**: 2026-04-13  
**Version Target**: v0.0.2  
**Status**: Planning  

---

## Executive Summary

Phase 3 (thinking extraction + tool span race fix) completed. The extension is **functional and validated** but needs production hardening before widespread deployment.

**Phase 4 Goals**:
1. Add resilience patterns (circuit breaker, rate limiting)
2. Implement security features (secret redaction)
3. Complete missing high-value telemetry (turn spans, tool schemas)
4. Add operational tooling (health checks, better error handling)

---

## Priority Backlog

### P1 High Priority (v0.0.2 - Required for Production)

| ID | Feature | Effort | Risk | Value |
|----|---------|--------|------|-------|
| P1-1 | Circuit breaker for API failures | 1h | Low | 🔴 Critical |
| P1-2 | Secret redaction for tool inputs | 1h | Low | 🔴 Critical |
| P1-3 | Turn spans for multi-turn tracking | 2h | Medium | 🟠 High |
| P1-4 | Tool-specific schemas | 3h | Medium | 🟠 High |

### P2 Medium Priority (v0.0.3 - Enhancement)

| ID | Feature | Effort | Risk | Value |
|----|---------|--------|------|-------|
| P2-1 | Fix assistant response parent | 15min | Low | 🟡 Medium |
| P2-2 | Token usage aggregation | 1h | Low | 🟡 Medium |
| P2-3 | Add missing hooks | 1.5h | Low | 🟡 Medium |
| P2-4 | Enforce payload limits | 30min | Low | 🟡 Medium |

### P3 Low Priority (v0.1.0 - Nice to Have)

| ID | Feature | Effort | Value |
|----|---------|--------|-------|
| P3-1 | Health check command | 1h | 🟢 Low |
| P3-2 | Rate limiting | 1h | 🟢 Low |
| P3-3 | Automated tests | 4h | 🟢 Low |
| P3-4 | Documentation improvements | 2h | 🟢 Low |

---

## Detailed Specifications

### P1-1: Circuit Breaker for API Failures

**Problem**: Silent span creation failures during API outages cause data loss with no backpressure.

**Current Behavior**:
```typescript
async createSpan(...) {
  try {
    const response = await this.api.post('/spans', payload);
    return response.details?.id;
  } catch (err) {
    this.logger.error('span_creation_failed', { sessionKey, schemaName });
    return null;  // ← Silent failure
  }
}
```

**Required Behavior**:
- Track consecutive failures
- Open circuit after 5 failures
- Fail fast when circuit is open (no API calls)
- Auto-close circuit after 30 seconds
- Log circuit state changes

**Implementation Plan**:

**File**: `src/agent.ts`

**Changes**:
1. Add circuit breaker state to `PrefactorAgent` class:
```typescript
private circuitBreaker = {
  consecutiveFailures: 0,
  lastFailureTime: 0,
  isOpen: false,
  openedAt: 0,
  threshold: 5,
  resetTimeoutMs: 30000,
};
```

2. Add circuit breaker methods:
```typescript
private canAttemptRequest(): boolean {
  if (!this.circuitBreaker.isOpen) {
    return true;
  }
  
  // Check if reset timeout has elapsed
  if (Date.now() - this.circuitBreaker.openedAt > this.circuitBreaker.resetTimeoutMs) {
    this.circuitBreaker.isOpen = false;
    this.logger.info('circuit_breaker_closed', { 
      failures: this.circuitBreaker.consecutiveFailures 
    });
    return true;
  }
  
  return false;
}

private recordSuccess(): void {
  this.circuitBreaker.consecutiveFailures = 0;
}

private recordFailure(): void {
  this.circuitBreaker.consecutiveFailures++;
  this.circuitBreaker.lastFailureTime = Date.now();
  
  if (this.circuitBreaker.consecutiveFailures >= this.circuitBreaker.threshold) {
    this.circuitBreaker.isOpen = true;
    this.circuitBreaker.openedAt = Date.now();
    this.logger.error('circuit_breaker_opened', {
      failures: this.circuitBreaker.consecutiveFailures,
      resetTimeoutMs: this.circuitBreaker.resetTimeoutMs,
    });
  } else {
    this.logger.warn('circuit_breaker_failure', {
      consecutiveFailures: this.circuitBreaker.consecutiveFailures,
      threshold: this.circuitBreaker.threshold,
    });
  }
}
```

3. Wrap API calls with circuit breaker:
```typescript
async createSpan(...) {
  if (!this.canAttemptRequest()) {
    this.logger.warn('circuit_open_span_skipped', { sessionKey, schemaName });
    return null;
  }
  
  try {
    const spanId = await this.doCreateSpan(...);
    this.recordSuccess();
    return spanId;
  } catch (err) {
    this.recordFailure();
    throw err;
  }
}
```

**Testing**:
- Simulate 5 API failures → verify circuit opens
- Wait 30s → verify circuit closes
- Verify spans skipped when circuit open

**Acceptance Criteria**:
- [ ] Circuit opens after 5 consecutive failures
- [ ] Spans skipped when circuit open (no API calls)
- [ ] Circuit auto-closes after 30s
- [ ] Logs show circuit state changes
- [ ] Success resets failure counter

---

### P1-2: Secret Redaction for Tool Inputs

**Problem**: Tool inputs may contain secrets (API keys, passwords) captured as-is in spans.

**Examples of Secrets to Redact**:
```bash
# API keys in headers
curl -H "Authorization: Bearer sk-abc123..." ...

# Environment variables
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI...

# Passwords in commands
mysql -u root -pMySecretPassword123 ...
```

**Implementation Plan**:

**File**: `src/index.ts` (new: `src/redaction.ts`)

**Redaction Patterns**:
```typescript
const SECRET_PATTERNS = [
  // Bearer tokens
  { pattern: /Bearer\s+[a-zA-Z0-9\-_\.]+/gi, replacement: 'Bearer [REDACTED]' },
  
  // API keys (various formats)
  { pattern: /api[_-]?key[=:\s]+['"]?[a-zA-Z0-9\-_]+['"]?/gi, replacement: 'api_key=[REDACTED]' },
  
  // AWS credentials
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED_AWS_KEY]' },
  { pattern: /aws[_-]?secret[_-]?access[_-]?key[=:\s]+['"]?[a-zA-Z0-9\/+=]+['"]?/gi, replacement: 'aws_secret_access_key=[REDACTED]' },
  
  // Generic secrets
  { pattern: /secret[=:\s]+['"]?[^\s'"]+['"]?/gi, replacement: 'secret=[REDACTED]' },
  { pattern: /password[=:\s]+['"]?[^\s'"]+['"]?/gi, replacement: 'password=[REDACTED]' },
  
  // Private keys (PEM format)
  { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
  
  // GitHub tokens
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, replacement: '[REDACTED_GH_TOKEN]' },
  { pattern: /github[_-]?token[=:\s]+['"]?[a-zA-Z0-9\-_]+['"]?/gi, replacement: 'github_token=[REDACTED]' },
];
```

**Redaction Function**:
```typescript
export function redactSecrets(input: unknown): unknown {
  if (typeof input === 'string') {
    let redacted = input;
    for (const { pattern, replacement } of SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, replacement);
    }
    return redacted;
  }
  
  if (Array.isArray(input)) {
    return input.map(item => redactSecrets(item));
  }
  
  if (typeof input === 'object' && input !== null) {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      // Skip redaction for keys that are clearly not sensitive
      if (!['path', 'command', 'exitCode', 'durationMs'].includes(key)) {
        redacted[key] = redactSecrets(value);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }
  
  return input;
}
```

**Usage in Tool Handlers**:
```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  if (config.captureToolInputs) {
    const redactedInput = redactSecrets(event.args);
    await sessionManager.createToolCallSpan(sessionKey, event.toolName, {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: redactedInput,
    });
  }
});
```

**Testing**:
- Test with bash command containing API key
- Test with tool input containing password
- Verify redaction in Prefactor backend

**Acceptance Criteria**:
- [ ] All secret patterns detected and redacted
- [ ] Redaction happens before span creation
- [ ] Config flag to disable if needed (`redactSecrets: boolean`)
- [ ] No false positives on normal commands

---

### P1-3: Turn Spans for Multi-Turn Tracking

**Problem**: Multi-turn agent runs (LLM → tools → LLM → tools) not tracked individually.

**Current Hierarchy** (missing turns):
```
pi:agent_run
  ├─ pi:tool_call
  ├─ pi:tool_call
  └─ pi:assistant_response
```

**Desired Hierarchy** (with turns):
```
pi:agent_run
  ├─ pi:turn (turnIndex: 0)
  │   ├─ pi:tool_call
  │   └─ pi:tool_call
  ├─ pi:turn (turnIndex: 1)
  │   └─ pi:assistant_response
```

**Implementation Plan**:

**File**: `src/session-state.ts`

**Changes**:
1. Add turn tracking to `SessionSpanState`:
```typescript
interface SessionSpanState {
  // ... existing fields
  currentTurnIndex: number;
  turnSpans: Map<number, string>;  // turnIndex -> spanId
}
```

2. Add turn span methods:
```typescript
async createTurnSpan(
  sessionKey: string,
  turnIndex: number,
  payload: {
    turnIndex: number;
    model?: string;
  }
): Promise<string | null> {
  const state = this.states.get(sessionKey);
  if (!state) {
    this.logger.warn('cannot_create_turn_span_no_state', { sessionKey, turnIndex });
    return null;
  }
  
  const spanId = await this.agent.createSpan(
    sessionKey,
    'pi:turn',
    payload,
    state.agentRunSpanId  // Parent is agent_run
  );
  
  if (spanId) {
    state.currentTurnIndex = turnIndex;
    state.turnSpans.set(turnIndex, spanId);
    this.logger.info('turn_span_created', { 
      sessionKey, 
      turnIndex, 
      spanId 
    });
  }
  
  return spanId;
}

async closeTurnSpan(
  sessionKey: string,
  turnIndex: number,
  resultPayload?: Record<string, unknown>
): Promise<void> {
  const state = this.states.get(sessionKey);
  if (!state) {
    this.logger.warn('cannot_close_turn_span_no_state', { sessionKey, turnIndex });
    return;
  }
  
  const spanId = state.turnSpans.get(turnIndex);
  if (!spanId) {
    this.logger.warn('turn_span_not_found', { sessionKey, turnIndex });
    return;
  }
  
  await this.agent.finishSpan(sessionKey, spanId, 'complete', resultPayload);
  this.logger.info('turn_span_closed', { sessionKey, turnIndex });
}
```

3. Register `pi:turn` schema in `src/agent.ts`:
```typescript
{
  name: 'pi:turn',
  description: 'Single turn in multi-turn agent execution',
  template: '{{ turnIndex | default: 0 }}',
  params_schema: {
    type: 'object',
    properties: {
      turnIndex: { type: 'number', description: 'Turn number (0-indexed)' },
      model: { type: 'string', description: 'Model used for this turn' },
    },
  },
}
```

4. Add hook handlers in `src/index.ts`:
```typescript
pi.on("turn_start", async (event, ctx) => {
  const sessionKey = await sessionManager.getSessionKey(ctx.sessionId);
  if (!sessionKey) return;
  
  await sessionManager.createTurnSpan(sessionKey, event.turnIndex, {
    turnIndex: event.turnIndex,
    model: ctx.model?.id,
  });
});

pi.on("turn_end", async (event, ctx) => {
  const sessionKey = await sessionManager.getSessionKey(ctx.sessionId);
  if (!sessionKey) return;
  
  await sessionManager.closeTurnSpan(sessionKey, event.turnIndex, {
    turnIndex: event.turnIndex,
    success: event.success,
  });
});
```

**Testing**:
- Test with multi-turn prompt (e.g., "Read file, then edit it")
- Verify turn spans created in correct order
- Check hierarchy in Prefactor CLI

**Acceptance Criteria**:
- [ ] Turn spans created for each turn
- [ ] Turn spans are children of agent_run
- [ ] Turn index tracked correctly
- [ ] Works with single-turn runs (no breaks)

---

### P1-4: Tool-Specific Schemas

**Problem**: All tools use generic `pi:tool_call` schema, limiting Prefactor's ability to validate and display tool-specific data.

**Implementation Plan**:

**File**: `src/agent.ts` (add schemas)  
**New File**: `src/tool-definitions.ts` (optional, for organization)

**Tool Schemas to Add**:

```typescript
// In agentSchemaVersion.span_type_schemas

// Bash tool
{
  name: 'pi:tool:bash',
  description: 'Bash command execution',
  template: '{{ command | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Bash command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds' },
      cwd: { type: 'string', description: 'Working directory' },
      // Result fields (on finish)
      exitCode: { type: 'number', description: 'Exit code' },
      stdout: { type: 'string', description: 'Standard output' },
      stderr: { type: 'string', description: 'Standard error' },
      durationMs: { type: 'number', description: 'Execution duration' },
    },
  },
}

// Read tool
{
  name: 'pi:tool:read',
  description: 'File read operation',
  template: '{{ path | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
      offset: { type: 'number', description: 'Start line number' },
      limit: { type: 'number', description: 'Maximum lines to read' },
      // Result fields
      contentLength: { type: 'number', description: 'Bytes read' },
      lineCount: { type: 'number', description: 'Lines read' },
      encoding: { type: 'string', description: 'File encoding' },
    },
  },
}

// Write tool
{
  name: 'pi:tool:write',
  description: 'File write operation',
  template: '{{ path | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write' },
      contentLength: { type: 'number', description: 'Bytes written' },
      created: { type: 'boolean', description: 'Whether file was created' },
      // Result fields
      backupPath: { type: 'string', description: 'Backup file path if created' },
      success: { type: 'boolean', description: 'Write success' },
    },
  },
}

// Edit tool
{
  name: 'pi:tool:edit',
  description: 'File edit operation',
  template: '{{ path | truncate: 100 }}',
  params_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to edit' },
      editCount: { type: 'number', description: 'Number of edit blocks' },
      // Result fields
      successCount: { type: 'number', description: 'Successful edits' },
      failedCount: { type: 'number', description: 'Failed edits' },
      oldTextHashes: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Hashes of replaced text',
      },
      newTextLengths: {
        type: 'array',
        items: { type: 'number' },
        description: 'Lengths of replacement text',
      },
    },
  },
}
```

**Usage in Tool Handlers**:
```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  const sessionKey = await sessionManager.getSessionKey(ctx.sessionId);
  if (!sessionKey) return;
  
  // Determine schema name based on tool name
  const schemaName = `pi:tool:${event.toolName}` as 
    | 'pi:tool:bash'
    | 'pi:tool:read'
    | 'pi:tool:write'
    | 'pi:tool:edit'
    | 'pi:tool_call';  // Fallback for unknown tools
  
  // Build tool-specific payload
  const payload: Record<string, unknown> = {
    toolCallId: event.toolCallId,
  };
  
  if (event.toolName === 'bash' && config.captureToolInputs) {
    payload.command = (event.args as { command?: string }).command;
    payload.timeout = (event.args as { timeout?: number }).timeout;
  } else if (event.toolName === 'read' && config.captureToolInputs) {
    payload.path = (event.args as { path?: string }).path;
    payload.offset = (event.args as { offset?: number }).offset;
    payload.limit = (event.args as { limit?: number }).limit;
  }
  // ... other tools
  
  await sessionManager.createToolCallSpan(sessionKey, event.toolName, payload, schemaName);
});
```

**Testing**:
- Test each tool type (bash, read, write, edit)
- Verify schema name in Prefactor backend
- Check payload validation

**Acceptance Criteria**:
- [ ] All 4 builtin tools have specific schemas
- [ ] Unknown tools fall back to `pi:tool_call`
- [ ] Tool-specific payloads captured correctly
- [ ] Schemas registered in agentSchemaVersion

---

## Implementation Roadmap

### Week 1: Production Hardening (v0.0.2-alpha)

**Day 1-2**: Circuit Breaker + Secret Redaction
- Implement circuit breaker in `agent.ts`
- Add redaction utilities in `redaction.ts`
- Test with simulated API failures
- Test with secret-containing commands

**Day 3-4**: Turn Spans
- Add turn tracking to `session-state.ts`
- Register `pi:turn` schema
- Add `turn_start` / `turn_end` handlers
- Test with multi-turn scenarios

**Day 5**: Tool-Specific Schemas
- Add tool schemas to `agent.ts`
- Update tool handlers to use specific schemas
- Test all 4 builtin tools

### Week 2: Testing & Polish (v0.0.2-beta)

**Day 1-2**: Integration Testing
- Test all P1 features together
- Validate with real coding sessions
- Fix any regressions

**Day 3**: Documentation
- Update DEVELOPMENT-GUIDE.md
- Add troubleshooting for new features
- Update README.md

**Day 4-5**: Bug Fixes & Release Prep
- Address any issues found in testing
- Prepare release notes
- Create PR for review

---

## Testing Strategy

### Unit Tests (Future - P3-3)

```typescript
// tests/circuit-breaker.test.ts
describe('Circuit Breaker', () => {
  test('opens after 5 failures', async () => { ... });
  test('closes after 30s timeout', async () => { ... });
  test('skips requests when open', async () => { ... });
});

// tests/redaction.test.ts
describe('Secret Redaction', () => {
  test('redacts Bearer tokens', () => { ... });
  test('redacts API keys', () => { ... });
  test('redacts AWS credentials', () => { ... });
  test('preserves non-sensitive data', () => { ... });
});
```

### Manual Testing (Current Phase)

**Circuit Breaker**:
```bash
# Simulate API failure (wrong token)
export PREFACTOR_API_TOKEN='invalid'
pi -p -e ./src/index.ts "Test"  # Repeat 5 times
# Verify circuit opens in logs
```

**Secret Redaction**:
```bash
# Test with secret in command
pi -p -e ./src/index.ts "Run: curl -H 'Authorization: Bearer sk-secret123' https://api.example.com"
# Verify redacted in Prefactor backend
```

**Turn Spans**:
```bash
# Multi-turn scenario
pi -p -e ./src/index.ts "Read the file src/index.ts, then tell me how many lines it has"
# Verify turn spans in hierarchy
```

**Tool Schemas**:
```bash
# Test each tool
pi -p -e ./src/index.ts "List files using bash"
pi -p -e ./src/index.ts "Read the README.md file"
pi -p -e ./src/index.ts "Write a test file"
pi -p -e ./src/index.ts "Edit the test file"
# Verify schema_name in Prefactor backend
```

---

## Success Metrics

### v0.0.2-alpha (End of Week 1)

- [ ] Circuit breaker opens after 5 failures ✅
- [ ] Secrets redacted from tool inputs ✅
- [ ] Turn spans created for multi-turn runs ✅
- [ ] Tool-specific schemas registered ✅

### v0.0.2-beta (End of Week 2)

- [ ] All P1 features tested and working ✅
- [ ] No regressions in existing functionality ✅
- [ ] Documentation updated ✅
- [ ] PR created and reviewed ✅

### Production Deployment

- [ ] Deployed to staging environment
- [ ] Tested with real user sessions (1 week)
- [ ] No critical bugs reported
- [ ] Ready for general availability

---

## Risk Mitigation

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Circuit breaker false positives | Low | Medium | Conservative threshold (5), auto-reset |
| Secret redaction false positives | Medium | Low | Whitelist safe keys, test extensively |
| Turn spans break single-turn | Low | High | Test with single-turn scenarios |
| Tool schemas break existing | Low | High | Fallback to generic schema |

### Schedule Risks

| Risk | Mitigation |
|------|------------|
| Feature creep | Stick to P1 only for v0.0.2 |
| Testing takes longer | Parallelize manual testing |
| Bugs found late | Daily testing, not just at end |

---

## Open Questions

1. **Should turn spans be optional?** (config flag)
   - Pro: Reduces span count for simple sessions
   - Con: Adds complexity, less consistent data
   - **Decision**: Implement without config flag (always on)

2. **Should we redact by default or opt-in?**
   - Pro (default): Secure by default, protects users
   - Con (opt-in): May break debugging workflows
   - **Decision**: Redact by default, add `redactSecrets: boolean` config

3. **Should tool schemas be strict or permissive?**
   - Pro (strict): Better validation, clearer contracts
   - Con (permissive): More flexible, handles edge cases
   - **Decision**: Permissive (additionalProperties: true)

---

## Next Steps

1. **Prioritize**: Which P1 feature first?
   - Recommendation: Circuit breaker + Secret redaction (production safety)
   
2. **Assign**: Who implements what?
   - Circuit breaker: ?
   - Secret redaction: ?
   - Turn spans: ?
   - Tool schemas: ?

3. **Schedule**: Timeline commitment?
   - v0.0.2-alpha: 1 week
   - v0.0.2-beta: 2 weeks

4. **Review**: PR process?
   - One PR per feature or one big PR?
   - **Recommendation**: One PR per feature (easier review)

---

## Appendix: File Change Summary

| Feature | Files Changed | Lines Added | Lines Removed |
|---------|---------------|-------------|---------------|
| Circuit Breaker | `src/agent.ts` | ~80 | ~10 |
| Secret Redaction | `src/redaction.ts` (new), `src/index.ts` | ~120 | ~5 |
| Turn Spans | `src/session-state.ts`, `src/agent.ts`, `src/index.ts` | ~100 | ~20 |
| Tool Schemas | `src/agent.ts`, `src/index.ts` | ~150 | ~30 |
| **Total** | **5 files** | **~450** | **~65** |

---

**Last Updated**: 2026-04-13  
**Version**: v0.0.2-planning
