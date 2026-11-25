# @prefactor/claude

## 2.1.0

### Minor Changes

- [#107](https://github.com/prefactordev/typescript-sdk/pull/107) [`4c7b5f6`](https://github.com/prefactordev/typescript-sdk/commit/4c7b5f6bd5ec5b702e3b7efcb9766058e61cb84e) Thanks [@simonrussell](https://github.com/simonrussell)! - Support the latest framework releases and refresh dependencies.

  - `@prefactor/claude`: the traced query now forwards every control method to the underlying Claude Agent SDK query instead of a fixed list. Previously, methods added in newer SDK releases (for example `getContextUsage` and `readFile` in 0.2.141) were missing from the traced query and threw `TypeError` when called. The peer range now also accepts `@anthropic-ai/claude-agent-sdk` 0.3.x.
  - `@prefactor/ai`: the peer range now accepts AI SDK v7, and the middleware records the same spans on v6 and v7. Token usage on AI SDK v5 is now recorded correctly; v5 reports token counts as plain numbers, which were previously read as 0.
  - `@prefactor/cli`: rebuilt against zod 4.6.7, which fixes a memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5) in the zod version bundled into the CLI binary.

## 2.0.0

### Patch Changes

- Updated dependencies [[`f768847`](https://github.com/prefactordev/typescript-sdk/commit/f768847fa1d1c79a239553cb7e8cf1111554da49), [`83a3c2f`](https://github.com/prefactordev/typescript-sdk/commit/83a3c2f36366be0021dba16d90799a9ec9e3b782)]:
  - @prefactor/core@1.0.0

## 1.0.1

### Patch Changes

- [#54](https://github.com/prefactordev/typescript-sdk/pull/54) [`f74b890`](https://github.com/prefactordev/typescript-sdk/commit/f74b890de563becb24f3f3e4c74acf43a1b045d8) Thanks [@Siutan](https://github.com/Siutan)! - Add package `repository` metadata so npm provenance validation succeeds on publish.

- Updated dependencies [[`f74b890`](https://github.com/prefactordev/typescript-sdk/commit/f74b890de563becb24f3f3e4c74acf43a1b045d8)]:
  - @prefactor/core@0.5.1

## 1.0.0

### Patch Changes

- Updated dependencies [[`0e9b675`](https://github.com/prefactordev/typescript-sdk/commit/0e9b67519e6a538d9cf09218e75e006387f917b8)]:
  - @prefactor/core@0.5.0
