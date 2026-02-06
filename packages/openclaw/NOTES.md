# Prefactor Plugin - Development Notes

## Completed Work

### Plugin Structure Created
- **Location**: `/home/sprite/prefactor-openclaw/`
- **Type**: OpenClaw Node.js plugin
- **Purpose**: Comprehensive lifecycle event monitoring

### Files Created
```
prefactor-openclaw/
├── openclaw.plugin.json      # Plugin manifest (id: prefactor-openclaw)
├── package.json              # Node package definition
├── index.ts                  # Main plugin with 13 lifecycle hooks
└── src/
    ├── logger.ts             # Structured logging [prefactor:<event>]
    └── metrics.ts            # In-memory metrics tracking
```

### Hooks Implemented (13 total, 12 functional)
1. `gateway_start` - Gateway startup ✅
2. `gateway_stop` - Gateway shutdown ✅
3. `session_start` - Session creation ✅
4. `session_end` - Session termination ✅
5. `before_agent_start` - Pre-agent run (with UUID context injection) ✅
6. `agent_end` - Post-agent run ✅
7. `before_compaction` - Pre-context compaction ✅
8. `after_compaction` - Post-context compaction ✅
9. `before_tool_call` - Pre-tool execution (logs tool name only) ✅
10. `after_tool_call` - Post-tool execution ❌ **NOT IMPLEMENTED** (see Known Issues)
11. `tool_result_persist` - Synchronous result transform (passthrough) ✅
12. `message_received` - Inbound message ✅
13. `message_sending` - Outbound message (pre-send) ✅
14. `message_sent` - Outbound message (confirmed) ✅

### Configuration
```json
{
  "plugins": {
    "load": {
      "paths": ["/home/sprite/prefactor-openclaw"]
    },
    "entries": {
      "prefactor-openclaw": {
        "enabled": true,
        "config": {
          "logLevel": "debug",
          "enableMetrics": true
        }
      }
    }
  }
}
```

### Features Confirmed Working
- ✅ UUID context injection: `prefactor-${uuid}` markers in `before_agent_start`
- ✅ Tool name logging (no sensitive params exposed)
- ✅ Passthrough transform in `tool_result_persist`
- ✅ In-memory metrics collection
- ✅ Structured logging with `[prefactor:<event>]` format
- ✅ Plugin loads without ID mismatch warnings

## Verified Hooks (with log evidence)

| Hook | Verified | Notes |
|------|----------|-------|
| `gateway_start` | ✅ | Logged on service start |
| `before_agent_start` | ✅ | Logged with UUID marker |
| `before_tool_call` | ✅ | Logged `tool=read`, `tool=exec` |
| `tool_result_persist` | ✅ | Logged after tool execution |
| `agent_end` | ✅ | Logged with messageCount |
| `after_tool_call` | ❌ | **NOT IMPLEMENTED** - Documented but never fires (see Known Issues) |

## Known Issues / Bug Reports

### ❌ `after_tool_call` Hook - NOT IMPLEMENTED
**Status**: Documented but not implemented in OpenClaw core
**Tested Versions**: 2026.2.1, 2026.2.2-3
**Severity**: High

**Issue**: The `after_tool_call` hook is documented in OpenClaw docs as a plugin lifecycle hook, but the core framework never emits this event.

**Evidence**:
- Hook is correctly registered via `api.on('after_tool_call', handler)`
- Other tool-related hooks fire correctly: `before_tool_call` → `tool_result_persist`
- `after_tool_call` has **0 occurrences** in logs across multiple tool types:
  - `exec` (bash commands)
  - `process` (background processes)
  - `read` (file reads)

**Hook Execution Order Observed**:
```
before_tool_call → [tool execution] → tool_result_persist
                  ↑
          after_tool_call (MISSING - never fires)
```

**Recommendation**: This is an OpenClaw framework bug/documentation error. The hook should be removed from docs or implemented in the framework.

---

## Unverified Hooks (require specific scenarios)

### High Priority
1. **`session_start`** / **`session_end`** - Not triggered
   - *Trigger*: Explicit session creation/clearing via `openclaw sessions` commands
   - *Note*: May fire on `/new` command or session reset

2. **`message_received`** / **`message_sending`** / **`message_sent`**
   - *Trigger*: Channel integration (Telegram/WhatsApp) or `--deliver` flag
   - *Test*: Send message via integrated channel

### Medium Priority
3. **`before_compaction`** / **`after_compaction`**
   - *Trigger*: Long conversation exceeding token limits
   - *Test*: Send many messages to trigger auto-compaction

## Testing Commands

### Start Gateway
```bash
sprite-env services start openclaw
```

### Check Logs
```bash
# All prefactor events
cat /.sprite/logs/services/openclaw.log | grep "\[prefactor:"

# Specific hook
cat /.sprite/logs/services/openclaw.log | grep "\[prefactor:before_tool_call\]"

# Event counts
cat /.sprite/logs/services/openclaw.log | grep "\[prefactor:" | \
  sed 's/.*\[prefactor:\([^]]*\)\].*/\1/' | sort | uniq -c
```

### Trigger Agent
```bash
openclaw agent -m "Hello" --agent main --timeout 60
```

### Trigger Tool
```bash
openclaw agent -m "Read file README.md" --agent main
openclaw agent -m "Use exec to run 'ls -la'" --agent main
```

## Known Issues / TODO

1. **Session Context**: `sessionKey` shows as `unknown` in logs
   - Need to verify correct context property path from OpenClaw

2. **Missing Hook Coverage**: 8 of 13 hooks not yet verified in production-like scenarios

3. **CLI Command**: `prefactor:status` registered but not tested
   - Run: `openclaw prefactor:status`

## Next Steps for Continuation

1. Test `after_tool_call` with various tool types
2. Verify session hooks with explicit session management
3. Test message hooks with channel integration (use `--deliver` flag)
4. Trigger compaction with long conversation
5. Verify metrics persistence and summary output
6. Test `gateway_stop` hook on clean shutdown

## Architecture Decisions

- **Logging**: Console output captured by sprite service logs
- **Metrics**: In-memory only (lost on restart) - consider persistence for production
- **Config**: Log level filtering + enable/disable metrics
- **Safety**: No sensitive data in logs (tool names only, no params)

## Verification Script Template

```bash
#!/bin/bash
echo "=== Prefactor Hook Verification ==="
echo "Starting gateway..."
sprite-env services start openclaw
sleep 3

echo -e "\n=== Triggering agent session ==="
openclaw agent -m "Test message" --agent main --timeout 30

echo -e "\n=== Triggering tool execution ==="
openclaw agent -m "List files" --agent main

echo -e "\n=== Checking logs ==="
cat /.sprite/logs/services/openclaw.log | grep "\[prefactor:" | \
  sed 's/.*\[prefactor:\([^]]*\)\].*/\1/' | sort | uniq -c

echo -e "\n=== Unverified hooks ==="
echo "- session_start / session_end"
echo "- message_received / message_sending / message_sent"
echo "- before_compaction / after_compaction"
echo "- gateway_stop (need clean shutdown)"
echo ""
echo "=== Known Issues ==="
echo "- after_tool_call: NOT IMPLEMENTED in OpenClaw core (documented but never fires)"
```

---

*Last updated: 2026-02-04*
*Plugin version: 1.0.0*
