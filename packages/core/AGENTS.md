# AGENTS.md

## Scope
This file applies to `packages/core`.

## Package purpose
`@prefactor/core` provides framework-agnostic observability primitives for Prefactor.
It offers foundational tracing infrastructure used by framework-specific integrations like `@prefactor/langchain` and `@prefactor/ai`.
This package should be the home for all shared tracing logic.

## Before making changes
- Read relevant source files in `src/tracing/`, `src/transport/`, `src/config.ts` first.
- Understand the difference between core span types and provider-specific span types.
- Check existing tests in `tests/` for patterns.

Core should not be edited often, if you find that you need to make a change, consider if it belongs in a more specific package/provider instead.

## Architecture rules
- This package is the shared infrastructure layer.
- All reusable tracing, serialization, lifecycle, transport, and configuration logic lives here.
- Framework adapters (`@prefactor/langchain`, `@prefactor/ai`) should be thin and import from core.
- Do NOT duplicate shared logic in adapter packages.

## Span type conventions
Core defines minimal span types:
- `agent` - Long-running agent sessions
- `llm` - LLM calls
- `tool` - Tool executions
- `chain` - Chain executions

Rules:
- Keep core span types minimal.
- Framework adapters define their own package-prefixed span types (e.g., `langchain:agent`, `ai-sdk:llm`).
- Do NOT collapse provider-specific span types into core enum values.
- Custom span types use string literals, not enum extension.

## Agent span lifecycle
This package implements a two-pattern approach:

1. **Agent spans**: Emitted immediately on start, finished later via explicit `finishSpan()`
   - Enables real-time tracking in UI
   - For long-running agent sessions spanning multiple API calls

2. **Other spans** (LLM, tool, chain): Emitted on `endSpan()` with full data
   - Short-lived operations
   - Lower overhead

Preserve this distinction.

## Context propagation
Uses `AsyncLocalStorage` via `SpanContext`:
- `SpanContext.runAsync()` wraps async work
- `SpanContext.getCurrent()` retrieves current span
- Child spans inherit `traceId` and `parentSpanId`

Provider integrations must use explicit tracer injection, NOT global state.

## Key files
- `src/tracing/span.ts`: Span types, status, interfaces
- `src/tracing/context.ts`: AsyncLocalStorage wrapper
- `src/tracing/tracer.ts`: Span lifecycle management
- `src/tracing/with-span.ts`: Manual instrumentation helper
- `src/transport/http.ts`: HTTP transport with queue
- `src/config.ts`: Zod-validated configuration
- `src/agent/instance-manager.ts`: Agent lifecycle management
- `src/client.ts`: Global singleton for providers

## Change rules
- If adding reusable tracing logic, add it here, not in adapter packages.
- If changing span types, update relevant tests.
- If changing transport behavior, verify it works for all adapters.
- If adding configuration, use Zod with environment variable fallbacks.

When working with packages that depend on core, refer to the relevent AGENTS.md for that package first.

## Never do
- Do not add speculative span types.
- Do not rely on global state in provider integrations.
- Do not duplicate core logic in adapter packages.
- Do not change span type semantics without migration path.
- Never use `additionalProperties: false` to block additional data - allow unknown fields to pass through.
