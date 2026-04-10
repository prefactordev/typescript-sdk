# Extension Test Scenarios

Testing the pi-prefactor extension with and without required configuration.

---

## Scenario 1: WITHOUT Required Configuration

### Setup
```bash
# No PREFACTOR_API_TOKEN or PREFACTOR_AGENT_ID set
unset PREFACTOR_API_TOKEN
unset PREFACTOR_AGENT_ID
```

### What Happens

**1. Extension loads** ✅
```
[test-harness] Initializing test harness extension
[test-harness] Extension initialized
[test-harness] Registered hooks: ...
```

**2. Configuration validation fails** ❌
```typescript
// In src/index.ts (pseudo-code)
const config = loadConfig(packageConfig);
const validation = validateConfig(config);

// validation = {
//   ok: false,
//   error: 'Missing required configuration: PREFACTOR_API_TOKEN, PREFACTOR_AGENT_ID',
//   missing: ['PREFACTOR_API_TOKEN', 'PREFACTOR_AGENT_ID']
// }
```

**3. Extension logs error and exits early** ⚠️
```
[pi-prefactor] Configuration error: Missing required configuration: PREFACTOR_API_TOKEN, PREFACTOR_AGENT_ID
[pi-prefactor] Extension will not instrument spans
[pi-prefactor] Run /prefactor-config for setup instructions
```

**4. Hooks still fire (test harness only)** ✅
```
[2026-04-09T12:00:00.000Z] [test-harness] session_start                  session:abc12345
[2026-04-09T12:00:10.000Z] [test-harness] input                         session:abc12345
[2026-04-09T12:00:10.001Z] [test-harness] before_agent_start            session:abc12345
...
```

**5. No span creation** ❌
- Agent HTTP client NOT initialized
- Session state manager NOT initialized
- No API calls to Prefactor
- No spans created

**6. User can run `/prefactor-config`** ℹ️
```
/prefactor-config

Output:
Prefactor Extension Configuration:

Status: ❌ Invalid

Missing required configuration:
  - PREFACTOR_API_TOKEN
  - PREFACTOR_AGENT_ID

Note: PREFACTOR_API_URL is optional (defaults to https://app.prefactorai.com)

Set environment variables:
  export PREFACTOR_API_TOKEN=your-token
  export PREFACTOR_AGENT_ID=your-agent-id
```

### Summary (Without Config)

| Aspect | Status |
|--------|--------|
| Extension loads | ✅ Yes |
| Hooks fire | ✅ Yes (test harness) |
| Configuration valid | ❌ No |
| Agent HTTP client | ❌ Not initialized |
| Session manager | ❌ Not initialized |
| Spans created | ❌ No |
| API calls made | ❌ No |
| Error logged | ✅ Yes (clear message) |
| Help available | ✅ Yes (`/prefactor-config`) |
| pi continues working | ✅ Yes (extension gracefully degrades) |

---

## Scenario 2: WITH Required Configuration

### Setup
```bash
export PREFACTOR_API_TOKEN=your-actual-token
export PREFACTOR_AGENT_ID=your-actual-agent-id
# Optional - defaults to https://app.prefactorai.com
# export PREFACTOR_API_URL=https://app.prefactorai.com
```

### What Happens

**1. Extension loads** ✅
```
[test-harness] Initializing test harness extension
[test-harness] Extension initialized
[test-harness] Registered hooks: ...
```

**2. Configuration validation passes** ✅
```typescript
const config = loadConfig(packageConfig);
const validation = validateConfig(config);

// validation = { ok: true }

// config = {
//   apiUrl: 'https://app.prefactorai.com',  // default
//   apiToken: 'your-actual-token',
//   agentId: 'your-actual-agent-id',
//   agentName: 'Pi Agent',
//   logLevel: 'info',
//   ...
// }
```

**3. Extension initializes fully** ✅
```
[pi-prefactor] Configuration loaded successfully
[pi-prefactor] API URL: https://app.prefactorai.com
[pi-prefactor] Agent ID: your-actual-agent-id
[pi-prefactor] Log Level: info
[pi-prefactor] Extension initialized
```

**4. Agent HTTP client created** ✅
```typescript
const agent = createAgent({
  apiUrl: config.apiUrl,
  apiToken: config.apiToken,
  agentId: config.agentId,
  agentName: config.agentName,
  agentVersion: config.agentVersion,
}, logger);
```

**5. Session state manager created** ✅
```typescript
const sessionManager = createSessionStateManager(agent, logger, {
  userInteractionTimeoutMs: config.userInteractionTimeoutMinutes * 60 * 1000,
  sessionTimeoutMs: config.sessionTimeoutHours * 60 * 60 * 1000,
});
```

**6. Hooks fire AND create spans** ✅
```
[2026-04-09T12:00:00.000Z] [pi-prefactor] session_start                  session:abc12345
[2026-04-09T12:00:00.001Z] [pi-prefactor] Creating session span...
[2026-04-09T12:00:00.100Z] [pi-prefactor] Session span created: span-123

[2026-04-09T12:00:10.000Z] [pi-prefactor] input                         session:abc12345
[2026-04-09T12:00:10.001Z] [pi-prefactor] Creating user interaction span...
[2026-04-09T12:00:10.100Z] [pi-prefactor] Interaction span created: span-456

[2026-04-09T12:00:12.000Z] [pi-prefactor] tool_execution_start          session:abc12345 { toolName: 'bash' }
[2026-04-09T12:00:12.001Z] [pi-prefactor] Creating tool call span...
[2026-04-09T12:00:12.100Z] [pi-prefactor] Tool span created: span-789
```

**7. API calls made to Prefactor** ✅
```typescript
// POST https://app.prefactorai.com/api/agent-instances
{
  "agent_id": "your-actual-agent-id",
  "agent_version": { ... },
  "agent_schema_version": { ... }
}

// POST https://app.prefactorai.com/api/spans
{
  "details": {
    "agent_instance_id": "instance-123",
    "schema_name": "pi:session",
    "status": "active",
    "payload": { ... }
  },
  "idempotency_key": "uuid..."
}
```

**8. Spans appear in Prefactor UI** ✅
```
Session: abc12345
  └─ user_interaction
      ├─ user_message
      ├─ agent_run
      │   └─ tool_call (bash)
      └─ assistant_response
```

**9. User can verify with `/prefactor-config`** ✅
```
/prefactor-config

Output:
Prefactor Extension Configuration:

Status: ✅ Valid

- apiUrl: https://app.prefactorai.com
- agentId: your-actual-agent-id
- agentName: Pi Agent
- logLevel: info
- captureThinking: true
- apiToken: ***xyz
```

### Summary (With Config)

| Aspect | Status |
|--------|--------|
| Extension loads | ✅ Yes |
| Hooks fire | ✅ Yes |
| Configuration valid | ✅ Yes |
| Agent HTTP client | ✅ Initialized |
| Session manager | ✅ Initialized |
| Spans created | ✅ Yes |
| API calls made | ✅ Yes |
| Spans in Prefactor UI | ✅ Yes |
| Error logged | ❌ No (success) |
| Help available | ✅ Yes (`/prefactor-config`) |
| pi continues working | ✅ Yes |

---

## Side-by-Side Comparison

| Step | Without Config | With Config |
|------|---------------|-------------|
| 1. Extension loads | ✅ | ✅ |
| 2. Config validation | ❌ Fails | ✅ Passes |
| 3. Error logged | ✅ Yes | ❌ No |
| 4. Agent client init | ❌ Skipped | ✅ Yes |
| 5. Session manager init | ❌ Skipped | ✅ Yes |
| 6. Hooks fire | ✅ Yes | ✅ Yes |
| 7. Spans created | ❌ No | ✅ Yes |
| 8. API calls | ❌ No | ✅ Yes |
| 9. Prefactor UI | ❌ Nothing | ✅ Spans appear |
| 10. pi works | ✅ Yes | ✅ Yes |

---

## Code Flow Diagram

### Without Config
```
Extension loads
  ↓
loadConfig() → { apiUrl: 'https://app.prefactorai.com', apiToken: undefined, agentId: undefined }
  ↓
validateConfig() → { ok: false, missing: ['PREFACTOR_API_TOKEN', 'PREFACTOR_AGENT_ID'] }
  ↓
Log error message
  ↓
Register /prefactor-config command
  ↓
Return early (don't initialize agent/session-manager)
  ↓
Hooks still fire (but don't create spans)
  ↓
pi continues normally (no instrumentation)
```

### With Config
```
Extension loads
  ↓
loadConfig() → { apiUrl: 'https://app.prefactorai.com', apiToken: '***', agentId: 'your-id' }
  ↓
validateConfig() → { ok: true }
  ↓
Log success message
  ↓
Initialize Agent HTTP client
  ↓
Initialize Session State Manager
  ↓
Register all hooks (with span creation logic)
  ↓
Register /prefactor-config command
  ↓
Hooks fire AND create spans
  ↓
API calls to Prefactor
  ↓
Spans appear in Prefactor UI
  ↓
pi continues normally (with instrumentation)
```

---

## Actual Test Commands

### Test WITHOUT Config

```bash
# Ensure no config
unset PREFACTOR_API_TOKEN
unset PREFACTOR_AGENT_ID

# Run test harness
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
pi -e ./test-harness.ts

# Expected output:
# [pi-prefactor] Configuration error: Missing required configuration: PREFACTOR_API_TOKEN, PREFACTOR_AGENT_ID
# [pi-prefactor] Extension will not instrument spans

# In pi, type:
/test-harness  # Shows hook validation
/prefactor-config  # Shows configuration error with instructions
```

### Test WITH Config

```bash
# Set config
export PREFACTOR_API_TOKEN=your-token
export PREFACTOR_AGENT_ID=your-agent-id

# Run test harness
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
pi -e ./test-harness.ts

# Expected output:
# [pi-prefactor] Configuration loaded successfully
# [pi-prefactor] API URL: https://app.prefactorai.com
# [pi-prefactor] Agent ID: your-agent-id
# [pi-prefactor] Extension initialized

# In pi, type:
/test-harness  # Shows hook validation
/prefactor-config  # Shows ✅ Valid configuration

# Check Prefactor UI at https://app.prefactorai.com
# Should see spans for the session
```

---

## Graceful Degradation

**Key design principle**: The extension NEVER breaks pi.

### Without Config
- ✅ Extension loads successfully
- ✅ All hooks still fire (for test harness)
- ✅ pi continues working normally
- ✅ User gets clear error message
- ✅ User gets help command (`/prefactor-config`)
- ❌ No spans created (expected)

### With Invalid Config
- ✅ Extension loads successfully
- ✅ Validation catches errors
- ✅ Clear error messages
- ❌ No spans created (expected)

### With Valid Config
- ✅ Everything works
- ✅ Spans created
- ✅ Prefactor UI shows data

---

## Error Recovery

If user starts without config, then adds it:

```bash
# 1. Start without config
pi -e ./test-harness.ts
# Shows error message

# 2. Set config in another terminal
export PREFACTOR_API_TOKEN=your-token
export PREFACTOR_AGENT_ID=your-agent-id

# 3. In pi, reload extension
/reload

# 4. Verify config loaded
/prefactor-config
# Shows: ✅ Valid

# 5. Continue using pi with instrumentation
```

---

## Conclusion

**Without config**: Extension gracefully degrades, logs clear error, provides help command, pi continues working.

**With config**: Full instrumentation, spans created, Prefactor UI populated.

**Either way**: pi never crashes, user always gets clear feedback.
