# @prefactor/pi-prefactor-ext

Prefactor instrumentation extension for the pi coding agent. Automatically creates distributed tracing spans for agent sessions, user interactions, tool calls, and responses.

## Quick Start

### 1. Set Environment Variables

```bash
export PREFACTOR_API_TOKEN='your-api-token'
export PREFACTOR_AGENT_ID='your-agent-id'
# Optional: PREFACTOR_API_URL defaults to https://app.prefactorai.com
```

### 2. Install Extension

**Global (all projects)**:
```bash
cp -r /path/to/pi-prefactor-ext ~/.pi/agent/extensions/pi-prefactor
```

**Project-local**:
```bash
cp -r /path/to/pi-prefactor-ext .pi/extensions/pi-prefactor
```

### 3. Reload pi

```
/reload
```

### 4. Verify Configuration

```
/prefactor-config
```

Expected output:
```
Prefactor Extension Configuration:

Status: ✅ Valid

- apiUrl: https://app.prefactorai.com
- agentId: your-agent-id
- agentName: Pi Agent
- logLevel: info
```

## Configuration

### Required (2 environment variables)

| Variable | Description | Example |
|----------|-------------|---------|
| `PREFACTOR_API_TOKEN` | Prefactor API token for authentication | `eyJhbGci...` |
| `PREFACTOR_AGENT_ID` | Agent ID registered in Prefactor | `01knv0ft...` |

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `PREFACTOR_API_URL` | `https://app.prefactorai.com` | Prefactor API endpoint |
| `PREFACTOR_AGENT_NAME` | `Pi Agent` | Human-readable agent name |
| `PREFACTOR_LOG_LEVEL` | `info` | Logging level (debug/info/warn/error) |
| `PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES` | `5` | Interaction span timeout |
| `PREFACTOR_SESSION_TIMEOUT_HOURS` | `24` | Session span timeout |
| `PREFACTOR_MAX_INPUT_LENGTH` | `10000` | Max input chars to capture |
| `PREFACTOR_MAX_OUTPUT_LENGTH` | `10000` | Max output chars to capture |

## Span Hierarchy

```
pi:session (root, 24hr lifetime)
  └─ pi:user_interaction (5min idle timeout)
      ├─ pi:user_message (user input)
      ├─ pi:agent_run (agent execution)
      │   └─ pi:tool_call (tool executions)
      └─ pi:assistant_response (LLM response)
      └─ pi:agent_thinking (reasoning, when available)
```

## Commands

### /prefactor-config

Shows current configuration status.

## Troubleshooting

### "Missing required configuration"

Set required environment variables:
```bash
export PREFACTOR_API_TOKEN='your-token'
export PREFACTOR_AGENT_ID='your-agent-id'
```

Then reload pi: `/reload`

### No spans appearing in Prefactor

1. Verify credentials are correct
2. Check logs for errors: `[pi-prefactor:*]`
3. Use CLI to verify agent registration

## License

MIT
