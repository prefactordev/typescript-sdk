---
"@prefactor/cli": minor
---

Require spec-mandated CLI output fields (still nullable where the spec uses `| null`). This is a TypeScript break for mock or partial constructors of those response types.

Bump is minor, not major: `@prefactor/cli` is 0.x (a major changeset would publish 1.0.0), and this is a compile-time type tightening.
