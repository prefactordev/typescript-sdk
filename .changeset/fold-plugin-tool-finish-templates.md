---
"@prefactor/openclaw-prefactor-plugin": patch
---

Fold finish-time tool summary fields (output size, exit code, result count, success/error) into the single span `template` so finished tool spans still have outcome text after `result_template` was removed. The plugin package has no test framework configured; this change is untested beyond typecheck/lint.
