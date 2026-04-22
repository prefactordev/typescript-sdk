# @prefactor/livekit

LiveKit Agents integration for Prefactor observability. This package traces `voice.AgentSession`
lifecycle events into Prefactor spans using the core provider API.

## Installation

```bash
npm install @prefactor/livekit
# or
bun add @prefactor/livekit
```

This package requires `@prefactor/core` and `@livekit/agents` as peer dependencies:

```bash
npm install @prefactor/core @livekit/agents
# or
bun add @prefactor/core @livekit/agents
```

## Quick Start

```ts
import { init } from '@prefactor/core';
import { PrefactorLiveKit } from '@prefactor/livekit';
import { voice } from '@livekit/agents';

const prefactor = init({
  provider: new PrefactorLiveKit(),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: 'v1.0.0',
    agentName: 'Voice Agent',
  },
});

const session = new voice.AgentSession({
  llm: 'openai/gpt-4.1-mini',
});

const { createSessionTracer } = prefactor.getMiddleware();
const sessionTracer = createSessionTracer();

await sessionTracer.attach(session);
// ... run the session ...
await sessionTracer.close();

await prefactor.shutdown();
```

## Configuration

Custom tool schemas should be passed through `httpConfig.agentSchema.toolSchemas`, following the
same schema pattern as the other Prefactor TypeScript provider packages.

```ts
import { init } from '@prefactor/core';
import { DEFAULT_LIVEKIT_AGENT_SCHEMA, PrefactorLiveKit } from '@prefactor/livekit';

const prefactor = init({
  provider: new PrefactorLiveKit(),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: 'livekit-v1',
    agentSchema: {
      ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
      toolSchemas: {
        lookupWeather: {
          spanType: 'livekit:tool:lookup-weather',
          inputSchema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        },
      },
    },
  },
});
```

## What Gets Traced

- Session attach/start/close lifecycle
- User turns from transcription and state change events
- Assistant turns from speech and committed conversation items
- Function tool executions
- Session usage updates
- LiveKit component metrics when component emitters expose `metrics_collected`
- LiveKit session errors
