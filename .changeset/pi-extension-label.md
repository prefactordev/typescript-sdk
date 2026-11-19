---
"@prefactor/pi": patch
---

pi now lists the extension as `@prefactor/pi` in its startup extensions list instead of `@prefactor/pi:dist`. The package registers a small `extensions/index.js` entry that re-exports the built extension, because pi names a packaged extension after its entry file's folder.
