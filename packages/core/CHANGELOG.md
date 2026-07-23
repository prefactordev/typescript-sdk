# @prefactor/core

## 0.5.0

### Minor Changes

- [#51](https://github.com/prefactordev/typescript-sdk/pull/51) [`0e9b675`](https://github.com/prefactordev/typescript-sdk/commit/0e9b67519e6a538d9cf09218e75e006387f917b8) Thanks [@joshgillies](https://github.com/joshgillies)! - Add instance purpose and quality schema support to the core SDK. Agent instance registration now accepts an optional `purpose` field (`'live' | 'smoke_test' | 'eval'`), forwarded to the API with no SDK-imposed default. Agent schema versions now support an optional `quality_schema` field mirroring span type schema shape. Agent instances can be updated with a `quality_payload` via the new `updateInstance()` method on `AgentInstanceManager` and `updateAgentInstance()` on the transport.
