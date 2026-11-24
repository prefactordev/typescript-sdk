---
"@prefactor/claude": minor
"@prefactor/ai": minor
"@prefactor/cli": patch
---

Support the latest framework releases and refresh dependencies.

- `@prefactor/claude`: the traced query now forwards every control method to the underlying Claude Agent SDK query instead of a fixed list. Previously, methods added in newer SDK releases (for example `getContextUsage` and `readFile` in 0.2.141) were missing from the traced query and threw `TypeError` when called. The peer range now also accepts `@anthropic-ai/claude-agent-sdk` 0.3.x.
- `@prefactor/ai`: the peer range now accepts AI SDK v7, and the middleware records the same spans on v6 and v7. Token usage on AI SDK v5 is now recorded correctly; v5 reports token counts as plain numbers, which were previously read as 0.
- `@prefactor/cli`: rebuilt against zod 4.6.7, which fixes a memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5) in the zod version bundled into the CLI binary.
