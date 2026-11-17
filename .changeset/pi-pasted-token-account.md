---
"@prefactor/pi": patch
---

Save the account id when `/prefactor setup` uses a pasted agent-deployment token, so `/prefactor status` shows the account as well as the agent. A deployment token cannot read the agent's or account's name, so `agent_name` and `account_name` are saved only by browser sign-in, and the README now says which credentials-file fields are optional.
