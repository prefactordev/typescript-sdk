# AGENTS.md

## Scope
This file applies to `packages/ai`.

## Package purpose
`@prefactor/ai` integrates Prefactor observability with Vercel AI SDK.
It provides tracing for model calls, tool executions, and agent workflows via `wrapLanguageModel`.
This package depends on `@prefactor/core` for tracing infrastructure.

## Before making changes
- Read `src/provider.ts`, `src/middleware.ts`, `src/init.ts` first.
- Preserve existing public exports from `src/index.ts` unless the task requires a public API change.
- Check whether the change belongs in `@prefactor/core` before implementing package-local logic.

## Architecture rules
- This package should remain a thin AI SDK-specific adapter over shared tracing infrastructure.
- Keep reusable tracing, serialization, lifecycle, and transport logic in `@prefactor/core`.
- Do not duplicate shared logic locally if it can live in core.

## Integration points
- AI SDK integration is implemented through `wrapLanguageModel`.
- Middleware behavior centers on:
  - `transformParams`: Wraps tool execute functions to capture tool spans
  - `wrapGenerate`: Intercepts non-streaming LLM calls
  - `wrapStream`: Intercepts streaming LLM calls
- Supports AI SDK versions `^6.0.0`.
- When working with the AI SDK, use the Skill provided in `.agents/skills/ai-sdk`

## Span conventions
This package uses package-prefixed span types:
- `ai-sdk:agent`
- `ai-sdk:llm`
- `ai-sdk:tool`

Rules:
- Preserve package-prefixed span naming.
- Do not collapse these span types into generic core enum values.
- `spanType` is used for schema categorization and analytics (`ai-sdk:llm`, `ai-sdk:tool`).
- `name` is used as a display label in traces (`ai:llm-call`, `ai:tool-call`).
- Do not change existing span names or types without updating schema handling, tests, and any affected public behavior.

## Usage patterns
Two patterns are supported:
1. **Provider pattern** (recommended): `PrefactorAISDK` passed to `@prefactor/core`'s `init()`
2. **Standalone pattern**: `init()` from `@prefactor/ai` creates its own core runtime

Always use Provider pattern.

## Agent lifecycle
- Agent starts on first LLM call
- Finishes via 5-minute timeout (`AGENT_DEAD_TIMEOUT_MS`)
- Implicit lifecycle (auto-start/timeout) is intentional - matches AI SDK stateless usage
- Do NOT make timeout configurable without strong use case

## Instance model
- Single global instance using `globalMiddleware` and `globalTracer`
- Multiple independent instances per process is NOT a supported use case
- Do NOT add multi-instance support

## Key files
- `src/index.ts`: public exports
- `src/provider.ts`: PrefactorAISDK provider class and default schema
- `src/middleware.ts`: AI SDK middleware implementation
- `src/init.ts`: standalone initialization
- `src/types.ts`: TypeScript types

## Change rules
- If changing span types, update schema definitions, middleware behavior, and tests together.
- If changing middleware lifecycle behavior, verify parent/child span relationships are preserved.
- If a change introduces reusable logic, move it to `@prefactor/core` instead of duplicating it here.

## Never do
- Do not add speculative span types.
- Do not move shared tracing logic out of core into this package.
- Do not change public exports from `src/index.ts` casually.
- Do not change span naming semantics without a deliberate migration path.
- Do not add multi-instance support.
