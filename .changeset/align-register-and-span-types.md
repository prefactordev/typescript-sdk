---
"@prefactor/core": minor
"@prefactor/cli": patch
---

Align agent instance register and span create client types with the OpenAPI contract. Register now types optional `id`, `update_current_version`, and instance-level `external_identifier`; span create requires a string `agent_instance_id` and accepts `cancelled` status.
