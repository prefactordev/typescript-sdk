---
"@prefactor/pi": patch
---

Fix `pi install npm:@prefactor/pi`, which installed an extension that failed to load with "Cannot find module 'zod'". pi installs packages without their peer dependencies, so `zod`, a peer dependency of `@prefactor/core`, was never installed; `@prefactor/pi` now depends on it directly.

Declare pi 0.99.0 as the lowest supported release in the peer dependencies on `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`, which accepted any version before. pi 0.99.0 is the first release that reports everything the extension records, including which tool made a nested tool call. The README now states the supported pi version.
