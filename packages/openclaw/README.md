# @prefactor/openclaw

OpenClaw lifecycle event monitoring and instrumentation for Prefactor.

## Overview

This plugin provides lifecycle event monitoring and instrumentation for OpenClaw agents. It automatically collects agent runtime operations and sends them to Prefactor.

## Getting Started

To get started with `@prefactor/openclaw`, follow these steps:

1. Install the plugin:

```bash
openclaw plugins install @prefactor/openclaw
```

2. Enable the plugin:

```bash
openclaw plugins enable prefactor
```

3. Get your Prefactor agent credentials from the Prefactor dashboard.

4. Configure the plugin to use your agent credentials with following commands:
```bash
openclaw config set plugins.entries.prefactor.config.agentId "${PREFACTOR_AGENT_ID}"
openclaw config set plugins.entries.prefactor.config.apiToken "${PREFACTOR_API_TOKEN}"
openclaw config set plugins.entries.prefactor.config.apiUrl "${PREFACTOR_API_URL}"
```

## Configuration

Enable the plugin in `~/.openclaw/.openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "prefactor": {
        "enabled": true,
        "config": {
          "agentId": "${PREFACTOR_AGENT_ID}",
          "apiToken": "${PREFACTOR_API_TOKEN}",
          "apiUrl": "${PREFACTOR_API_URL}"
        }
      }
    }
  }
}
```

## Plugin Management

```bash
# Install the plugin
openclaw plugins install @prefactor/openclaw

# Upgrade to latest version
openclaw plugins update @prefactor/openclaw

# List all plugins
openclaw plugins list

# Check plugin info (shows current version)
openclaw plugins info prefactor

# Enable/disable
openclaw plugins enable prefactor
openclaw plugins disable prefactor

# Configuration
openclaw config set plugins.entries.prefactor.config.agentId "${PREFACTOR_AGENT_ID}"
openclaw config set plugins.entries.prefactor.config.apiToken "${PREFACTOR_API_TOKEN}"
openclaw config set plugins.entries.prefactor.config.apiUrl "${PREFACTOR_API_URL}"
```

## Exports

### Plugin Entry Point

```typescript
import register from '@prefactor/openclaw';

// Used by OpenClaw to load the plugin
// Do not import directly in user code
```

### Agent HTTP Client

```typescript
import { Agent, AgentConfig, createAgent } from '@prefactor/openclaw';
```

### Session State Manager

```typescript
import { SessionStateManager, createSessionStateManager } from '@prefactor/openclaw';
```

### Logging

```typescript
import { Logger, LogLevel, createLogger } from '@prefactor/openclaw';
```

## Span Types

The plugin creates the following span hierarchy:

| Span Type | Schema | Description |
|-----------|--------|-------------|
| `session` | `openclaw:session` | Root span with 24hr lifetime |
| `user_interaction` | `openclaw:user_interaction` | User interaction with 5min idle timeout |
| `user_message` | `openclaw:user_message` | Inbound message from user (instant) |
| `agent_run` | `openclaw:agent_run` | Agent execution run |
| `tool_call` | `openclaw:tool_call` | Tool execution (concurrent) |
| `assistant_response` | `openclaw:assistant_response` | Assistant response (instant) |

## Hook Handlers

The plugin registers 14 hooks with OpenClaw:

| Hook | Category | Action |
|------|----------|--------|
| `gateway_start` | Gateway | Logging |
| `gateway_stop` | Gateway | Emergency cleanup |
| `session_start` | Session | Logging |
| `session_end` | Session | Close all spans, finish agent instance |
| `before_agent_start` | Agent | Create user_message + agent_run spans |
| `agent_end` | Agent | Close agent_run, create assistant_response |
| `before_compaction` | Compaction | Logging |
| `after_compaction` | Compaction | Logging |
| `before_tool_call` | Tool | Create tool_call span |
| `after_tool_call` | Tool | Logging (hook is broken in OpenClaw) |
| `tool_result_persist` | Tool | Close tool_call span |
| `message_received` | Message | Buffer message for before_agent_start |
| `message_sending` | Message | Logging |
| `message_sent` | Message | Logging |

## Requirements

- OpenClaw >= 2026.2.9
- Node.js >= 22.0.0
- @prefactor/core (peer dependency)

## License

This plugin is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
