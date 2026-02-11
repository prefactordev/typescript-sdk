# @prefactor/openclaw

OpenClaw lifecycle event monitoring and instrumentation for Prefactor.

## Configuration

Enable the plugin in `~/.openclaw/.openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "prefactor": {
        "enabled": false,
        "config": {
          "agentId": "$PREFACTOR_AGENT_ID",
          "apiKey": "$PREFACTOR_API_KEY",
          "apiUrl": "$PREFACTOR_API_URL",
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

# Uninstall
openclaw plugins uninstall @prefactor/openclaw
```

## Overview

This plugin provides lifecycle event monitoring and instrumentation for Prefactor SDK within OpenClaw environments. It automatically traces agent operations and sends telemetry to your Prefactor backend.


## License

This plugin is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
