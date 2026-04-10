# Test Harness

Minimal extension for validating hook registrations and event data shapes.

## Usage

### Quick Test (One-off)

```bash
cd /home/sprite/typescript-sdk/packages/pi-prefactor-ext
pi -e ./test-harness.ts
```

### Install for Auto-Discovery

```bash
# Global (all projects)
cp -r /home/sprite/typescript-sdk/packages/pi-prefactor-ext ~/.pi/agent/extensions/pi-prefactor-test

# Project-local
cp -r /home/sprite/typescript-sdk/packages/pi-prefactor-ext .pi/extensions/pi-prefactor-test
```

Then in pi:
```bash
/reload  # If already running
/test-harness  # Show validation report
```

## What It Tests

The test harness validates:

1. **Hook Registration** - All 20 hooks are registered and fire correctly
2. **Event Data Shapes** - Event objects have expected properties
3. **Hook Execution Order** - Hooks fire in the expected sequence
4. **Session Key Stability** - Same session key across all events in a session
5. **Lifecycle Tracking** - Session, agent, turn, and tool lifecycles complete correctly

## Expected Output

When you interact with pi, you'll see logs like:

```
[2026-04-09T12:00:00.000Z] [test-harness] session_start                  session:abc12345 { reason: 'startup' }
[2026-04-09T12:00:01.000Z] [test-harness] resources_discover             session:abc12345 { cwd: '/home/sprite/project', reason: 'startup' }
[2026-04-09T12:00:10.000Z] [test-harness] input                         session:abc12345 { textPreview: 'What files are here?', source: 'interactive' }
[2026-04-09T12:00:10.001Z] [test-harness] before_agent_start            session:abc12345 { promptPreview: 'What files are here?' }
[2026-04-09T12:00:10.002Z] [test-harness] agent_start                   session:abc12345 {}
[2026-04-09T12:00:10.003Z] [test-harness] turn_start                    session:abc12345 { turnIndex: 0 }
[2026-04-09T12:00:10.004Z] [test-harness] before_provider_request        session:abc12345 { provider: 'anthropic', model: 'claude-sonnet-4-5' }
[2026-04-09T12:00:11.000Z] [test-harness] message_start                 session:abc12345 { role: 'assistant' }
[2026-04-09T12:00:11.100Z] [test-harness] message_update                session:abc12345 { deltaPreview: 'Let me check the ' }
[2026-04-09T12:00:12.000Z] [test-harness] tool_execution_start          session:abc12345 { toolName: 'bash', toolCallId: 'abc12345' }
[2026-04-09T12:00:12.001Z] [test-harness] tool_call                     session:abc12345 { toolName: 'bash', toolCallId: 'abc12345' }
[2026-04-09T12:00:12.500Z] [test-harness] tool_result                   session:abc12345 { toolName: 'bash', isError: false }
[2026-04-09T12:00:12.501Z] [test-harness] tool_execution_end            session:abc12345 { toolName: 'bash', durationMs: 501 }
[2026-04-09T12:00:13.000Z] [test-harness] turn_end                      session:abc12345 { turnIndex: 0, toolResultsCount: 1 }
[2026-04-09T12:00:13.001Z] [test-harness] agent_end                     session:abc12345 { success: true }
```

## Validation Command

Type `/test-harness` to see a validation report:

```
[test-harness] Validation Report:
  Total hooks fired: 42
  Session started: true
  Turns processed: 2
  Session key: ephemeral-1234567890-abc123
  Hook order (first 10): session_start → resources_discover → input → before_agent_start → agent_start → turn_start → before_provider_request → message_start → tool_execution_start → tool_call
[test-harness] ✓ All expected hooks registered
```

## Hook Order Validation

Expected hook sequence for a simple prompt with tool calls:

```
session_start
  └─ resources_discover
      └─ input
          └─ before_agent_start
              └─ agent_start
                  └─ turn_start
                      └─ before_provider_request
                          └─ message_start (assistant)
                              └─ message_update (streaming)
                                  └─ tool_execution_start
                                      └─ tool_call
                                          └─ tool_result
                                              └─ tool_execution_end
                                                  └─ message_end (tool result)
                                                      └─ turn_end
                                                          └─ agent_end
```

## Troubleshooting

### No logs appearing

- Check that extension is loaded: `/reload` and look for "Test harness loaded" notification
- Check console output (pi runs in your terminal, logs go to stdout)

### Session key changes between events

This is expected for ephemeral sessions. The test harness caches the key per context.

### Hook not firing

- Verify the event name is correct (see extensions.md)
- Check if an earlier handler returned `{ action: "handled" }` (for input event)
- Check if an earlier handler returned `{ block: true }` (for tool_call event)

## Next Steps

Once the test harness validates hook registrations work correctly:

1. Copy core files from `openclaw-prefactor-plugin` (agent.ts, session-state.ts, etc.)
2. Implement actual span creation in the hook handlers
3. Test with Prefactor API credentials
4. Verify spans appear in Prefactor UI
