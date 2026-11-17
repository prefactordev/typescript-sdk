---
"@prefactor/pi": patch
---

Fix `pi install npm:@prefactor/pi`, which installed an extension that failed to load with "Cannot find module 'zod'". pi installs packages without their peer dependencies, so `zod`, a peer dependency of `@prefactor/core`, was never installed; `@prefactor/pi` now depends on it directly.

Declare pi 1.1.0 as the lowest supported release in the peer dependencies on `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`, which accepted any version before. pi 1.1.0 is the first release that reports everything the extension records, including tool call durations and the parent of nested tool calls. The README now states the supported versions and when the recorded pi version can differ from the running pi.
