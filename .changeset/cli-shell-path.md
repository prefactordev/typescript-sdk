---
"@prefactor/cli": patch
---

The shell installer adds `$HOME/.prefactor/bin` to the shell startup file and links `prefactor` into a directory already on PATH, so the command works in the current terminal. It never replaces another `prefactor` command already on PATH. On macOS, bash users get the export in the login file bash actually reads. If the startup file cannot be written, the installer prints the manual PATH line instead of failing.
