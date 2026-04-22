# livekit-web-research-agent

Voice-first LiveKit web research agent with Exa-backed search and optional
Prefactor tracing.

This mirrors the Python example in `/Users/mcb/code/livekit-agent`, but uses the
TypeScript repo-native `@prefactor/livekit` provider and the Node.js LiveKit
Agents SDK.

## Setup

1. Copy the example environment file:

```sh
cp .env.example .env
```

Or edit `mise.local.toml` with your own values and run `mise -E local ...`.

2. Set:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `EXA_API_KEY`

3. Install repo dependencies:

```sh
bun install
```

4. Download the LiveKit model assets:

```sh
mise -E local run download-files
```

## Run

Run the worker against a LiveKit deployment:

```sh
mise -E local run dev
```

Connect directly to a room during local development:

```sh
mise -E local run connect -- --room call-local
```

## Optional Config

- `AGENT_PRESET` (`budget` or `balanced`)
- `EXA_SEARCH_MAX_RESULTS`
- `EXA_SEARCH_TYPE`
- `EXA_INCLUDE_DOMAINS`
- `PREFACTOR_API_URL`
- `PREFACTOR_API_TOKEN`
- `PREFACTOR_AGENT_ID`
- `PREFACTOR_AGENT_NAME`
- `LIVEKIT_REMOTE_EOT_URL`

## Notes

- This example uses `@prefactor/livekit` plus two custom Prefactor spans:
  `example:session_setup` and `example:web_search`.
- The Node.js worker CLI does not expose the Python repo's console audio mode, so
  this example uses the standard `dev`, `connect`, and `download-files` commands.
