---
name: prefactor-skill-selector
description: Use when choosing which Prefactor SDK skill to load for agent instrumentation or for building a custom provider integration on top of @prefactor/core.
---

# Prefactor Skill Selector

Use this file as a router for Prefactor skills.

## Available Skill

- `skills/instrument-existing-agent-with-prefactor-sdk/SKILL.md`: instrument an existing agent with Prefactor SDK so coding tools can see runs, llm/tool spans, token usage, and failures.
- `skills/create-provider-package-with-core/SKILL.md`: create a new provider package as a thin adapter over `@prefactor/core` with core-first boundaries and tracing conventions.

## Selection Rule

- If the request is about adding telemetry to an existing agent without rewriting business logic, load `skills/instrument-existing-agent-with-prefactor-sdk/SKILL.md`.
- If the request is about creating a custom provider adapter with `@prefactor/core`, load `skills/create-provider-package-with-core/SKILL.md`.
