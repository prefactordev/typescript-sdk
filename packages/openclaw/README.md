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
          "apiKey": "${PREFACTOR_API_KEY}",
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
openclaw config set plugins.entries.prefactor.config.agentId "<your_agent_id>"
openclaw config set plugins.entries.prefactor.config.apiKey "<your_api_key>"
openclaw config set plugins.entries.prefactor.config.apiUrl "<prefacor_api_url>"
```

## Overview

This plugin provides lifecycle event monitoring and instrumentation for OpenClaw agents. It automatically collects agent runtime operations and sends them to Prefactor.


## License

This plugin is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
