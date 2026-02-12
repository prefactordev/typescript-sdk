# @prefactor/openclaw

OpenClaw lifecycle event monitoring and instrumentation for Prefactor.

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

## Overview

This plugin provides lifecycle event monitoring and instrumentation for OpenClaw agents. It automatically collects agent runtime operations and sends them to Prefactor.


## License

This plugin is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
