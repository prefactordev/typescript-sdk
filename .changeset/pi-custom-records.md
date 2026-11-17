---
"@prefactor/core": minor
"@prefactor/pi": patch
---

Let agents built on pi's SDK add to what `@prefactor/pi` records. `prefactorExtension()` now takes the agent version's name and description, extra span types, quality schemas and alert schemas, and per-tool span type details that keep each tool's `$agent:tool:<name>` type. Its `onSessionStart` option receives a recorder for the session, which opens custom spans in the session's span tree and records quality and raises alerts on the session's agent instance with the agent-deployment token.

`@prefactor/core` gains `alert_schemas` on `AgentSchemaVersion` (the `AlertSchema` type) and `AgentInstanceClient.raiseAlert()`, so alerts can be declared and raised on an agent instance without calling the API directly.
