# @prefactor/pi

A [pi](https://pi.dev) extension that records pi sessions in Prefactor. Each pi session becomes one Prefactor agent instance, with spans for its agent runs, LLM responses and tool calls.

> **Sensitive data:** the extension records prompts, completions and tool results as they are, without redaction. Coding sessions often contain source code, credentials and other secrets, so do not use it for sessions that handle data you cannot send to Prefactor.

## Installation

```bash
pi install npm:@prefactor/pi
```

To try it for one run without adding it to your settings:

```bash
pi -e npm:@prefactor/pi
```

## Credentials

The extension sends spans with a Prefactor agent-deployment token. When a session starts, it reads credentials from the first of these sources that supplies a token:

1. Options passed to `prefactorExtension()` in code.
2. The environment variables `PREFACTOR_API_URL`, `PREFACTOR_API_TOKEN` and `PREFACTOR_AGENT_ID`.
3. The credentials file `~/.pi/agent/prefactor.json`. It follows pi's `PI_CODING_AGENT_DIR` setting when that is set.

The agent id comes from the same source as the token. When that source has no agent id, the extension reads it from the token with `GET /api/v1/ping`. The API URL comes from the token's source or a later one, and defaults to `https://app.prefactorai.com`.

The credentials file holds:

```json
{
  "api_url": "https://app.prefactorai.com",
  "api_token": "<agent-deployment token>",
  "agent_id": "<agent id>"
}
```

When no token is found, the extension records nothing and tells you once how to set Prefactor up, so pi keeps working. In interactive and RPC modes the notice appears in pi. In print and JSON modes it is written to stderr.

## What gets recorded

| Span type | Covers | Recorded |
| --- | --- | --- |
| `pi:session` | One pi session | Session id, working directory, mode, start reason and model; shutdown reason |
| `pi:agent_run` | One agent run, from `agent_start` to `agent_end` | User prompt and images; final response text, stop reason and error |
| `pi:llm` | One assistant message | Provider, model and the messages added to the context since the previous LLM call; content, stop reason, token usage (including cache read and cache write tokens), cost and duration |
| `pi:tool:read`, `pi:tool:write`, `pi:tool:edit`, `pi:tool:bash` | pi's built-in tools | Arguments; result content, details, error flag and duration |
| `pi:tool` | Any other tool | As for the built-in tools |

LLM responses and tool calls are children of their agent run. A tool call made by another tool, such as a codemode script, is a child of that tool's span.

The agent version is pi's release version. The working directory on each session lets you tell apart sessions from different repositories that report to the same agent.

Long strings are truncated to `PREFACTOR_MAX_INPUT_LENGTH` and `PREFACTOR_MAX_OUTPUT_LENGTH` characters (10,000 by default).

## Shutdown and Ctrl+C

The session appears in Prefactor as soon as it starts. Each span is sent as soon as it starts or finishes, and the agent instance is finished when pi runs `session_shutdown`.

Pressing Ctrl+C in print, JSON or RPC mode ends pi without running `session_shutdown`. Spans that had already finished are recorded. The open agent run, the session span and the agent instance stay active in Prefactor.

## Example

[`examples/pi/print-mode.ts`](../../examples/pi/print-mode.ts) runs `pi` once in print mode with the extension loaded from this repository.

## Requirements

- Node.js >= 22.19.0
- pi (`@earendil-works/pi-coding-agent`) 1.5.2 or later
