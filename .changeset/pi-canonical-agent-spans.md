---
"@prefactor/pi": patch
---

Record pi sessions with Prefactor's canonical agent span types, so each session opens in Prefactor's conversation view. Inside the `pi:session` root span, the extension now records the system prompt when it changes, a user turn with its user message for every prompt, steering and follow-up message, and an assistant turn holding each LLM call, its thinking and text blocks, and the tool executions, with token usage in the canonical fields. Each tool pi has at session start gets its own span type, and tools added later use a fallback type. The `pi:agent_run`, `pi:llm` and `pi:tool*` span types are gone.
