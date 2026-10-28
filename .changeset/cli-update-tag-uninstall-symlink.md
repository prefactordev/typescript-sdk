---
"@prefactor/cli": patch
---

`prefactor update` now reports the installed release tag (for example `Updated Prefactor CLI to v0.6.0.`) instead of an empty tag when updating on the stable channel. `prefactor uninstall` also removes the `prefactor` symlink that the shell installer created on PATH, so no broken command is left behind. Symlinks that point at another install are left alone.
