---
"@prefactor/core": minor
---

Require spec-mandated fields on core span and instance HTTP response types (`details.id`, control `terminate`/`reason`, instance `status`/`termination_reason`). This is a TypeScript break for mock or partial constructors of those types.

Bump is minor, not major: this is a compile-time type tightening with no runtime contract change, and it matches the other spec-alignment type changesets on this branch.
