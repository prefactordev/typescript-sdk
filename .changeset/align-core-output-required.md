---
"@prefactor/core": patch
---

Require spec-mandated fields on core span and instance HTTP response types (`details.id`, control `terminate`/`reason`, instance `status`/`termination_reason`). This is a TypeScript break for mock or partial constructors of those types.
