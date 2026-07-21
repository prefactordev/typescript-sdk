---
"@prefactor/core": minor
---

Add instance purpose and quality schema support to the core SDK. Agent instance registration now accepts an optional `purpose` field (`'live' | 'smoke_test' | 'eval'`), forwarded to the API with no SDK-imposed default. Agent schema versions now support an optional `quality_schema` field mirroring span type schema shape. Agent instances can be updated with a `quality_payload` via the new `updateInstance()` method on `AgentInstanceManager` and `updateAgentInstance()` on the transport.
