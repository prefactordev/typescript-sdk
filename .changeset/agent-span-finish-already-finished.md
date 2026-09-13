---
"@prefactor/core": patch
---

Return a distinct already-finished result from agent span finish on 409 invalid_action instead of an empty object cast as AgentSpanResponse.
