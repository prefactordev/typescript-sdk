---
"@prefactor/cli": minor
---

Add the commands needed to run judges end to end from the CLI: `llm_providers` and `llm_provider_models`, `agent_deployments list_promotions` and `promote`, `agent_instances prepare`, `record_quality`, and `discard_sensitive`, a `--statuses` filter on `agent_instances list`, run input, result, and metadata options on `agent_instances register` and `finish`, instance payload schema options on `agent_schema_versions create`, `--agent_schema_version_id` and `--execution_mode` on `agent_versions create`, and `--team_id` and `--owner_person_id` on `judges create` and `update`. Fix `agent_associations list_from`, which sent `agent_id` where the API expects `agent_ids`; it now takes `--agent_ids`.
