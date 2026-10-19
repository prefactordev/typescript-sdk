---
"@prefactor/cli": minor
---

Add browser approval to `prefactor login`. The CLI prints an approval link, and a QR code of it when the terminal is wide enough, opens the link, and saves the account token once the login is approved in the browser. Servers without browser approval still use the paste flow.
