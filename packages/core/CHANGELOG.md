# @prefactor/core

## 1.0.0

### Major Changes

- [#59](https://github.com/prefactordev/typescript-sdk/pull/59) [`83a3c2f`](https://github.com/prefactordev/typescript-sdk/commit/83a3c2f36366be0021dba16d90799a9ec9e3b782) Thanks [@joshgillies](https://github.com/joshgillies)! - Add named quality schema support. Replace the singular `quality_schema` / `quality_payload` API with named quality schemas and keyed payloads (PRE-445).

  - `QualitySchema` gains a required `name` field
  - `AgentSchemaVersion.quality_schema` → `quality_schemas: QualitySchema[]`
  - `AgentInstanceManager.updateInstance({ qualityPayload })` → `recordQuality({ name, payload })`
  - `AgentInstanceClient.update()` (PUT) → `recordQuality()` (POST to `/record_quality`)
  - `Transport.updateAgentInstance()` → `Transport.recordQuality()`
  - `AgentInstanceUpdatePayload` → `AgentInstanceRecordQualityPayload`
  - `AgentUpdateAction` → `AgentRecordQualityAction`
  - `PrefactorTransportOperation` `'agent_update'` → `'agent_record_quality'`

  A null payload removes the recorded value for that name. Unknown fields are dropped by the API, so a client left on the old single-payload shape writes nothing and gets no error.

### Patch Changes

- [#61](https://github.com/prefactordev/typescript-sdk/pull/61) [`f768847`](https://github.com/prefactordev/typescript-sdk/commit/f768847fa1d1c79a239553cb7e8cf1111554da49) Thanks [@joshgillies](https://github.com/joshgillies)! - Replace `just` commands with `mise` in README development instructions and fix example file references to point to existing files (PRE-417).

## 0.5.1

### Patch Changes

- [#54](https://github.com/prefactordev/typescript-sdk/pull/54) [`f74b890`](https://github.com/prefactordev/typescript-sdk/commit/f74b890de563becb24f3f3e4c74acf43a1b045d8) Thanks [@Siutan](https://github.com/Siutan)! - Add package `repository` metadata so npm provenance validation succeeds on publish.

## 0.5.0

### Minor Changes

- [#51](https://github.com/prefactordev/typescript-sdk/pull/51) [`0e9b675`](https://github.com/prefactordev/typescript-sdk/commit/0e9b67519e6a538d9cf09218e75e006387f917b8) Thanks [@joshgillies](https://github.com/joshgillies)! - Add instance purpose and quality schema support to the core SDK. Agent instance registration now accepts an optional `purpose` field (`'live' | 'smoke_test' | 'eval'`), forwarded to the API with no SDK-imposed default. Agent schema versions now support an optional `quality_schema` field mirroring span type schema shape. Agent instances can be updated with a `quality_payload` via the new `updateInstance()` method on `AgentInstanceManager` and `updateAgentInstance()` on the transport.
