---
"@prefactor/cli": patch
---

Require spec-mandated CLI output fields (still nullable where the spec uses `| null`). This is a TypeScript break for mock or partial constructors of those response types.
