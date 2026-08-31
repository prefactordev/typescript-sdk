---
"@prefactor/cli": patch
---

Reject pagination offsets that contain trailing characters or decimal portions instead of truncating them with parseInt.
