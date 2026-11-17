---
"@prefactor/pi": patch
---

Simplify `/prefactor setup`. Browser sign-in is now the first option, and while pi waits for approval it shows only the sign-in link, clickable in terminals that support hyperlinks, and the code to approve. The QR code is gone, because pi cut it to a few rows and it could not be scanned. Choosing the agent now asks whether to create a new agent, with a name and description you can change, or use an existing one, picked from a list you can filter by typing. `@earendil-works/pi-tui` is now a peer dependency, supplied by pi.
