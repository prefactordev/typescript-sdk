---
"@prefactor/openclaw-prefactor-plugin": patch
---

Trace agent runs on OpenClaw 2026.8 and later. Those versions removed the `before_agent_start` hook the plugin used to start the `user_message` and `agent_run` spans, so agent runs went untraced. The plugin now starts them from `before_prompt_build`, and still listens to `before_agent_start` so older OpenClaw versions keep working. It also stops registering the removed `subagent_spawning` hook. On recent OpenClaw, set `plugins.entries.openclaw-prefactor-plugin.hooks.allowConversationAccess` to `true`, or OpenClaw won't deliver the agent and LLM hooks the plugin traces.
