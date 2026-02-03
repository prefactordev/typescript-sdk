# @prefactor/openclaw

OpenClaw plugin for Prefactor observability. Captures agent runs, tool calls, and message IO with minimal setup.

## Installation

```bash
npm install @prefactor/openclaw
# or
bun add @prefactor/openclaw
```

## OpenClaw Configuration

Add the plugin to your `openclaw.json` (JSON5):

```json5
{
  plugins: {
    enabled: true,
    entries: {
      "prefactor-observability": {
        enabled: true,
        config: {
          transportType: "http",
          httpConfig: {
            apiUrl: "https://api.prefactor.ai",
            apiToken: "$ENV:PREFACTOR_API_TOKEN",
            agentIdentifier: "openclaw-main"
          },
          sampleRate: 1.0,
          captureInputs: true,
          captureOutputs: true
        }
      }
    }
  }
}
```

## Environment Variables

For security, prefer environment variables for credentials:

- `PREFACTOR_API_URL`: API endpoint URL
- `PREFACTOR_API_TOKEN`: Authentication token
- `PREFACTOR_TRANSPORT`: `"stdio"` or `"http"` (default: `"stdio"`)
- `PREFACTOR_SAMPLE_RATE`: Sampling rate 0.0-1.0 (default: `1.0`)
- `PREFACTOR_CAPTURE_INPUTS`: Capture span inputs (default: `true`)
- `PREFACTOR_CAPTURE_OUTPUTS`: Capture span outputs (default: `true`)

## What Gets Traced

The plugin automatically captures:

- **Agent Runs**: Full agent execution with parent-child relationships
- **Tool Calls**: Tool name, inputs, outputs, duration with FIFO pairing
- **Messages**: Inbound and outbound message IO
- **Errors**: Automatic error tracking in spans

## Configuration Reference

### Transport Options

**HTTP Transport** (for Prefactor Cloud):
```json5
{
  transportType: "http",
  httpConfig: {
    apiUrl: "https://api.prefactor.ai",
    apiToken: "your-token",
    agentIdentifier: "my-agent",
    agentName: "My OpenClaw Agent"
  }
}
```

**STDIO Transport** (for local development):
```json5
{
  transportType: "stdio"
}
```

### Capture Settings

- `captureInputs`: Capture span inputs (default: `true`)
- `captureOutputs`: Capture span outputs (default: `true`)
- `maxInputLength`: Maximum input string length (default: `10000`)
- `maxOutputLength`: Maximum output string length (default: `10000`)

## Requirements

- Node.js >= 24.0.0
- OpenClaw >= 2026.1.26

## License

MIT
