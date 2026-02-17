---
name: instrument-existing-agent-with-prefactor-sdk
description: Use when an existing agent already works without Prefactor and you need to add tracing for runs, llm calls, tool calls, and failures with minimal behavior changes.
---

# Instrument Existing Agent With Prefactor SDK

Instrument a working agent that was built without Prefactor.

Core principle: instrument boundaries, not business logic.

## Quick Start

1. Identify runtime path: built-in adapter (`@prefactor/langchain` or `@prefactor/ai`) or custom `@prefactor/core` adapter.
2. Add one top-level run span and child spans around LLM/tool boundaries.
3. Preserve context propagation and package-prefixed span types.
4. Record error metadata and rethrow original errors.
5. Finish spans on success, error, cancel, and stream terminal paths.
6. Verify in your project's build/test/typecheck flow.

## Coding Tool Trigger Phrases

If the user asks for any of these, apply this skill:

- "instrument this existing agent"
- "this agent already works, add prefactor tracing"
- "wrap this existing langchain/ai agent with prefactor"
- "add tracing for tool calls and runs"
- "tool calls are missing in my coding tool timeline"

## Use With Custom Provider Skill

Sometimes you need both skills.

- If the framework/provider is already supported by a Prefactor adapter, use this skill directly.
- If the framework/provider is not supported yet (for example a custom Google SDK agent integration), first use `skills/create-provider-package-with-core/SKILL.md` to build a custom adapter, then use this skill to instrument the existing agent with that adapter.

Recommended sequence when unsupported:

1. Create provider adapter with `@prefactor/core`.
2. Integrate adapter into the existing agent entrypoint.
3. Validate run/llm/tool/error spans in real executions.

## Implementation Rules

- Prefer `@prefactor/langchain` or `@prefactor/ai` before low-level `@prefactor/core`.
- Keep provider span types package-prefixed (`langchain:*`, `ai-sdk:*`).
- Run nested work inside active context so parent/child trace trees stay intact.
- Capture input/output safely (redact secrets, enforce truncation limits).
- Instrumentation must never crash user code.

## Verification

Run equivalent project verification commands (for example build, typecheck, and tests).

Also run at least one real agent request and confirm:

- top-level run span exists
- child llm/tool spans are correctly nested
- terminal status appears for success and failure

## References

- For coding-tool-oriented keyword coverage and trigger wording, read `references/coding-tool-triggers.md`.
- For an execution checklist and failure diagnostics, read `references/instrumentation-checklist.md`.

## Common Mistakes

- Instrumenting every helper instead of boundaries.
- Using generic span types.
- Swallowing exceptions after logging.
- Missing stream cancel/error completion paths.
