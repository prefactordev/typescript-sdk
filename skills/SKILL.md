---
name: prefactor-skill-selector
description: Use when choosing which Prefactor SDK skill to load for agent instrumentation or for building a custom provider integration on top of @prefactor/core.
---

# Prefactor skill selector

Use this file as a router for Prefactor skills.

## Available skills

- `skills/bootstrap-existing-agent-with-prefactor-cli/SKILL.md`: provision Prefactor credentials with `prefactor setup` / `prefactor setup --create`, write env values, and choose a package.
- `skills/instrument-existing-agent-with-prefactor-sdk/SKILL.md`: instrument an existing agent with Prefactor SDK so coding tools can see runs, llm/tool spans, token usage, and failures.
- `skills/create-provider-package-with-core/SKILL.md`: create a new provider package as a thin adapter over `@prefactor/core` with core-first boundaries and tracing conventions.
- `skills/report-agent-risk-data/SKILL.md`: populate `data_risk` fields on span types for compliance tracking and data governance after an agent is already instrumented.
- `skills/write-span-summary-templates/SKILL.md`: write Liquid display templates on span type schemas so traces show readable one-line summaries in the Prefactor UI.
- `skills/inspect-agent-run-with-prefactor-cli/SKILL.md`: perform root-cause analysis on a Prefactor agent run from CLI span data; run in the agent's own codebase (user provides instance ID and symptom).

## Selection rules

- If the request is about provisioning Prefactor resources or credentials via CLI, load `skills/bootstrap-existing-agent-with-prefactor-cli/SKILL.md` first.
- If the request is about adding telemetry to an existing agent without rewriting business logic, load `skills/instrument-existing-agent-with-prefactor-sdk/SKILL.md`.
- If the request is about creating a custom provider adapter with `@prefactor/core`, load `skills/create-provider-package-with-core/SKILL.md`.
- If the request is about adding risk or compliance metadata to span types, load `skills/report-agent-risk-data/SKILL.md`.
- If the request is about span summary templates, display templates, Liquid templates on schemas, or making spans readable in the Prefactor UI, load `skills/write-span-summary-templates/SKILL.md`.
- If the request is about root-cause analysis on a bad, surprising, expensive, incomplete, or downvoted agent run, load `skills/inspect-agent-run-with-prefactor-cli/SKILL.md`.

## Default workflow

When instrumenting an existing agent, default to this order:

1. Confirm the human has run `prefactor login`.
2. Run `skills/bootstrap-existing-agent-with-prefactor-cli/SKILL.md` (`prefactor setup` or `prefactor setup --create --name ... --description ...`).
3. Inspect the project and install the matching Prefactor adapter (`@prefactor/langchain`, `@prefactor/ai`, `@prefactor/openclaw`, `@prefactor/claude`).
4. For adapter-style instrumentation, keep `init`, `withSpan`, and `shutdown` imports from that same adapter package (or pass an explicit tracer when using core `withSpan`).
5. If no matching adapter package exists, use `skills/create-provider-package-with-core/SKILL.md`.
6. Instrument the existing agent with `skills/instrument-existing-agent-with-prefactor-sdk/SKILL.md`.
7. Optionally populate compliance metadata with `skills/report-agent-risk-data/SKILL.md`.
8. Optionally add readable trace summaries with `skills/write-span-summary-templates/SKILL.md`.
