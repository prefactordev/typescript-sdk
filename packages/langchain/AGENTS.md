# AGENTS.md

## Scope
This file applies to `packages/langchain`.


## Package purpose
`@prefactor/langchain` integrates Prefactor observability with LangChain.js.
It provides tracing for model calls, tool executions, and agent workflows.
This package depends on `@prefactor/core` for tracing infrastructure.

## Before making changes
- Read `src/provider.ts`, `src/middleware.ts`, and relevant tests first.
- Preserve existing public exports from `src/index.ts` unless the task requires a public API change.
- Check whether the change belongs in `@prefactor/core` before implementing package-local logic.

## Architecture rules
- This package should remain a thin LangChain-specific adapter over shared tracing infrastructure.
- Keep reusable tracing, serialization, lifecycle, and transport logic in `@prefactor/core`.
- Do not duplicate shared logic locally if it can live in core.

## Integration points
- LangChain integration is implemented through `createMiddleware`.
- Middleware behavior currently centers on:
  - `wrapModelCall`
  - `wrapToolCall`
  - `beforeAgent`
  - `afterAgent`

Preserve this integration shape unless a change explicitly requires a migration.

## Span conventions
This package uses package-prefixed span types:
- `langchain:agent`
- `langchain:llm`
- `langchain:tool`
- `langchain:chain`

Rules:
- Preserve package-prefixed span naming.
- Do not collapse these span types into generic core enum values.
- `spanType` is used for schema categorization and analytics.
- `name` is used as a display label in traces.
- Do not change existing span names or types without updating schema handling, tests, and any affected public behavior.

## Current scope
- Agent, model, and tool tracing are first-class.
- `chain` exists in schema but is not actively populated in normal middleware flow.
- Do not add speculative tracing for chains, retrievers, embeddings, or other LangChain concepts unless there is a concrete integration point and test coverage.

## Key files
- `src/index.ts`: public exports
- `src/provider.ts`: provider class and default schema
- `src/middleware.ts`: LangChain middleware integration
- `src/metadata-extractor.ts`: token usage and metadata extraction
- `src/init.ts`: standalone initialization, if present

## Change rules
- If changing span types, update schema definitions, middleware behavior, and tests together.
- If changing metadata extraction, preserve backward-compatible output shapes unless explicitly changing public behavior.
- If changing middleware lifecycle behavior, verify parent/child span relationships are preserved.
- If a change introduces reusable logic, move it to `@prefactor/core` instead of duplicating it here.

## Never do
- Do not add speculative span types.
- Do not move shared tracing logic out of core into this package.
- Do not change span naming semantics without a reason and let the user know.
- Never bump the major version. For large refactors, changes, etc bump the minor version instead and for all other changes bump the patch version.
- Never use `additionalProperties: false` to block additional data - allow unknown fields to pass through.