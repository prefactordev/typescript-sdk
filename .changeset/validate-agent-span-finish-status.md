---
"@prefactor/cli": patch
---

Validate `agent_spans finish --status` against complete, failed, and cancelled so invalid values like `finished` fail at the CLI instead of reaching the API.
