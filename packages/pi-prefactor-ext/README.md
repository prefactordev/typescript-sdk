# @prefactor/pi-prefactor-ext

Prefactor instrumentation extension for the pi coding agent (Next Generation). Automatically creates distributed tracing spans for agent sessions, tool calls, and responses.

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
cp -r /path/to/pi-prefactor-ext ~/.pi/agent/extensions/pi-prefactor-ext
```

**Project-local**:
```bash
cp -r /path/to/pi-prefactor-ext .pi/extensions/pi-prefactor-ext
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
| `PREFACTOR_AGENT_VERSION` | `default` | Version suffix for tracking |
| `PREFACTOR_LOG_LEVEL` | `info` | Logging level (debug/info/warn/error) |
| `PREFACTOR_USER_INTERACTION_TIMEOUT_MINUTES` | `5` | Interaction span timeout |
| `PREFACTOR_SESSION_TIMEOUT_HOURS` | `24` | Session span timeout |
| `PREFACTOR_MAX_INPUT_LENGTH` | `10000` | Max input chars to capture |
| `PREFACTOR_MAX_OUTPUT_LENGTH` | `10000` | Max output chars to capture |
| `PREFACTOR_CAPTURE_TOOL_INPUTS` | `true` | Capture tool call inputs |
| `PREFACTOR_CAPTURE_TOOL_OUTPUTS` | `true` | Capture tool call outputs |
| `PREFACTOR_SAMPLE_RATE` | `1.0` | Sampling rate (0.0-1.0) |
| `PREFACTOR_ENABLED` | `true` | Enable/disable extension |

## Span Hierarchy

```
pi:session (root, 24hr lifetime)
  └─ pi:user_message (user input)
  └─ pi:agent_run (agent execution)
      ├─ pi:agent_thinking (reasoning, extracted from content)
      ├─ pi:tool:bash (bash command execution)
      ├─ pi:tool:read (file read operation)
      ├─ pi:tool:write (file write operation)
      ├─ pi:tool:edit (file edit operation)
      └─ pi:assistant_response (LLM response)
```

**Span Types**:
- `pi:session` - Root span for pi session lifecycle
- `pi:user_message` - Inbound user message/request
- `pi:agent_run` - Agent execution context
- `pi:agent_thinking` - Agent reasoning/thinking (extracted from content)
- `pi:tool:bash` - Bash command execution
- `pi:tool:read` - File read operation
- `pi:tool:write` - File write operation
- `pi:tool:edit` - File edit operation
- `pi:assistant_response` - Assistant response to user

## Usage Examples

### Basic File Operation

```bash
timeout 30 pi -p -e ./src/index.ts "Create a file called test.txt with hello world"
```

### Bash Command

```bash
timeout 30 pi -p -e ./src/index.ts "List all files in the current directory"
```

### Multi-file Edit

```bash
timeout 45 pi -p -e ./src/index.ts "Refactor the greeting function in src/utils.ts"
```

## Commands

### /prefactor-config

Shows current configuration status and validates environment variables.

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
3. Use CLI to verify agent registration:
   ```bash
   bun ./dist/bin/cli.js agents list
   ```

### Thinking spans not appearing

The extension extracts thinking from structured `ThinkingContent` blocks in the LLM response. If thinking spans are not appearing:

1. Check that the model supports extended thinking (e.g., Anthropic Claude, OpenAI o3/o4-mini)
2. Check debug logs for `agent_thinking_span_created_on_start` or `agent_thinking_span_created_retroactive`
3. Enable debug logging: `export PREFACTOR_LOG_LEVEL=debug`

### Tool spans showing "not found" warnings

This indicates a race condition. Verify:

1. `tool_execution_start` fires before `tool_result`
2. Session state is properly initialized
3. Check logs for: `tool_span_creation_complete`

### Session not closing properly

If spans remain "active" after session ends:

1. Check for unhandled errors in session shutdown hooks
2. Verify `session_shutdown` event is firing
3. Enable debug logging: `PREFACTOR_LOG_LEVEL=debug`

## Development

For development guide, debugging methodology, and tmux workflow, see [`AGENTS.md`](./AGENTS.md).

## License

MIT
