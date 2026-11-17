---
"@prefactor/pi": minor
---

Add `/prefactor setup`, `/prefactor status` and `/prefactor logout` to the pi extension. `/prefactor setup` connects pi to Prefactor through browser sign-in, with the code, link and QR code shown inside pi. It lets the user choose or create the agent, saves an agent-deployment token to `~/.pi/agent/prefactor.json` with mode `0600`, and revokes the sign-in's account token. Users no longer need the Prefactor CLI or to copy a token by hand. A pasted deployment token is the fallback when browser sign-in is unavailable.
