# `@prefactor/claude`

Prefactor tracing integration for the Claude Agent SDK.

## Usage

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { init } from '@prefactor/core';
import { PrefactorClaude } from '@prefactor/claude';

const prefactor = init({
  provider: new PrefactorClaude({ query }),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: 'my-claude-agent',
  },
});

const { tracedQuery } = prefactor.getMiddleware();
```

## Behavior

- `query` must be provided to `PrefactorClaude`.
- Custom agent schemas should be passed via `httpConfig.agentSchema`, not the provider constructor.
- Claude always captures assistant content and tool payloads using the package defaults.
- A middleware instance supports only one active `tracedQuery()` at a time.
- Overlapping `tracedQuery()` calls fail fast with an error instead of sharing runtime state unsafely.
- Tool-specific span types are resolved from normalized `httpConfig.agentSchema.toolSchemas`.

## Verification

Build and run tests first:

```bash
bun run build
bun test packages/claude/tests/
```

For live verification, set:

- `ANTHROPIC_API_KEY`
- `PREFACTOR_API_URL`
- `PREFACTOR_API_TOKEN`
- `PREFACTOR_AGENT_ID`

Then run:

```bash
START_TIME="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
bun examples/claude-agent/simple-agent.ts
END_TIME="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
INSTANCE_ID="$(
  prefactor agent_instances list --agent_id "$PREFACTOR_AGENT_ID" |
  node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const id=j.details?.at(-1)?.id;if(!id)process.exit(1);process.stdout.write(id);});"
)"
prefactor agent_spans list \
  --agent_instance_id "$INSTANCE_ID" \
  --start_time "$START_TIME" \
  --end_time "$END_TIME" \
  --include_summaries
```

Use `agent_spans` for verification. Instance span reporting is currently unreliable.
