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

**Note**: As of OpenClaw 2026.2.9 (33c75cb) installing the plugin will raise the following error:

> [openclaw] Failed to start CLI: Error: Config validation failed: plugins.entries.openclaw: plugin not found: openclaw

For now this is related to the following bug: https://github.com/openclaw/openclaw/pull/7090

You should continue with the following steps.


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
          "apiUrl": "${PREFACTOR_API_URL}",
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


## License

This plugin is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
