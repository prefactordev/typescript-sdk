# @prefactor/agent-spans

Thin Prefactor API client for forwarding pre-mapped agent spans.

Use this package when an external receiver or integration already has Prefactor span payloads and only needs the Prefactor API lifecycle:

- register an agent instance
- start the instance
- create spans with parent ID mapping
- finish the instance

This package intentionally does not instrument code, parse OpenTelemetry, batch requests, define schemas, or map provider payloads. Those responsibilities stay in the caller.

## Install

```sh
npm install @prefactor/core @prefactor/agent-spans
```

## Usage

```ts
import { PrefactorAgentSpanClient } from '@prefactor/agent-spans';

const client = new PrefactorAgentSpanClient({
  apiUrl: 'https://app.prefactorai.com',
  apiToken: process.env.PREFACTOR_API_TOKEN!,
  agentId: process.env.PREFACTOR_AGENT_ID!,
  environmentId: process.env.PREFACTOR_ENVIRONMENT_ID!,
  agentVersion: {
    externalIdentifier: 'external-receiver-v1',
    name: 'External Receiver',
    description: 'Forwards pre-mapped spans to Prefactor',
  },
});

const agentInstanceId = await client.registerAndStartInstance(agentSchemaVersion);

const rootSpanId = await client.createSpan(agentInstanceId, {
  externalSpanId: 'external-root',
  parentExternalSpanId: null,
  schemaName: 'external:agent',
  status: 'complete',
  startedAt: '2026-06-17T00:00:00.000Z',
  finishedAt: '2026-06-17T00:00:01.000Z',
  payload: { name: 'root' },
  resultPayload: {},
});

await client.finishInstance(agentInstanceId);
```

