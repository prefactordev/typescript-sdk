---
'@prefactor/core': major
---

Add named quality schema support. Replace the singular `quality_schema` / `quality_payload` API with named quality schemas and keyed payloads (PRE-445).

- `QualitySchema` gains a required `name` field
- `AgentSchemaVersion.quality_schema` → `quality_schemas: QualitySchema[]`
- `AgentInstanceManager.updateInstance({ qualityPayload })` → `recordQuality({ name, payload })`
- `AgentInstanceClient.update()` (PUT) → `recordQuality()` (POST to `/record_quality`)
- `Transport.updateAgentInstance()` → `Transport.recordQuality()`
- `AgentInstanceUpdatePayload` → `AgentInstanceRecordQualityPayload`
- `AgentUpdateAction` → `AgentRecordQualityAction`
- `PrefactorTransportOperation` `'agent_update'` → `'agent_record_quality'`

A null payload removes the recorded value for that name. Unknown fields are dropped by the API, so a client left on the old single-payload shape writes nothing and gets no error.