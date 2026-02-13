# AGENTS.md

This file guides coding agents working in this repo.

## Repository overview
- Monorepo with Bun workspaces under `packages/*`.
- Packages: `core`, `langchain`, `ai`.
- Source code: `packages/<pkg>/src`.
- Tests: `packages/<pkg>/tests`.
- Build outputs: `packages/<pkg>/dist`.
- Root examples live under `examples/`.

## Architecture map
- Tracing layer: `packages/core/src/tracing/*` (span models, tracer lifecycle).
- Context propagation: `packages/core/src/tracing/context.ts` (AsyncLocalStorage).
- Transport layer: `packages/core/src/transport/*` (stdio + http).
- Queue layer: `packages/core/src/queue/*` (in-memory queue, actions).
- Config: `packages/core/src/config.ts` (Zod + env fallbacks).
- LangChain integration: `packages/langchain/src/*`.
- AI SDK integration: `packages/ai/src/*`.

## Core-first philosophy
- Prefer putting shared behavior, data shaping, lifecycle helpers, and instrumentation logic in `packages/core`.
- Keep provider packages (`langchain`, `ai`, etc) as thin adapters over provider-specific APIs.
- Before adding logic to a provider package, check whether it can be a reusable core utility.
- Avoid duplicate implementations across provider packages; extract to core first, then adapt.
- Design decisions should default to "core-first" unless a provider-specific constraint requires local behavior.
- Across all development work, implement only the minimum required behavior for current requirements.
- Prefer direct 1:1 mappings between requirements and implementation; avoid speculative abstractions.
- Do not add optional, speculative, or future-use code, APIs, schemas, configs, or examples unless explicitly requested.

## Toolchain
- Runtime: Node >= 22 (see `package.json`), dev uses Bun.
- Install toolchain: `mise install`.
- Install deps: `mise run install` or `bun install`.
- Prefer `mise run` commands; they wrap the canonical Bun commands.

## Build / lint / test / typecheck
- Build all: `mise run build` or `bun run build`.
- Build one package: `mise run build-core` / `mise run build-langchain` / `mise run build-ai`.
- Build with filter: `bun run scripts/build.ts --filter @prefactor/core`.
- Lint: `mise run lint` or `bun run lint` (Biome).
- Format: `mise run format` or `bun run format`.
- Typecheck: `mise run typecheck` or `bun run typecheck` (project refs).
- Tests (all): `mise run test` or `bun test`.
- Tests (watch): `mise run test-watch` or `bun test --watch`.
- Single test file: `bun test packages/core/tests/tracing/tracer.test.ts`.
- Single test by name: `bun test --test-name-pattern "should create span"`.
- Package test folder: `bun test packages/langchain/tests/`.
- CI runs lint, typecheck, test, build (see `.github/workflows/ci.yml`).
- Always run `bun run build` before tests or other checks that require built packages.

## Build outputs
- Build script: `scripts/build.ts` creates ESM + CJS bundles.
- Root exports use package `src/index.ts` to define public API.
- External deps for bundles include `@langchain/core` and `zod`.

## Formatting (Biome)
- 2-space indent, line width 100.
- Single quotes, semicolons, trailing commas (ES5).
- Run Biome for formatting instead of manual alignment.

## Imports and module style
- Use ESM `import`/`export`; prefer named exports.
- Use `import type` or `type` modifiers for type-only imports.
- Keep external imports before relative imports.
- Use explicit `.js` extensions in relative imports (TS emits ESM).
- Avoid default exports unless a file already uses one.
- Keep barrel exports in package `index.ts` files tidy and alphabetic when possible.

## Types and data shapes
- Prefer `unknown` to `any`; narrow with runtime checks.
- Use `Record<string, unknown>` for generic payloads.
- Use explicit return types for public APIs and async methods (`: Promise<void>`).
- When parsing JSON, cast with `as { ... }` and validate defensively.
- `any` is allowed only where provider payloads are truly dynamic.
- If using `any`, include the `biome-ignore` comment explaining why.
- Avoid widening to `object`; prefer structured types or `Record`.

## Naming and file layout
- Files: kebab-case (e.g. `instance-manager.ts`).
- Classes/Enums: PascalCase; functions/vars: camelCase.
- Constants: UPPER_SNAKE_CASE (e.g. `MODEL_SETTINGS`).
- Public exports live in each package's `src/index.ts`.
- Keep package boundaries: `langchain` and `ai` depend on `core`.

## Error handling and logging
- Instrumentation must never throw new errors; log and continue.
- If wrapping user code, rethrow the original error after recording spans.
- Prefer `getLogger('namespace')` for structured logs in core packages.
- Use `console.error` only where logger is not available.
- Keep error payloads consistent with `ErrorInfo` (type, message, stacktrace).
- Do not let logging throw; guard against missing data.

## Tracing and context
- Context propagation relies on `AsyncLocalStorage` wrappers.
- Wrap async work in `SpanContext.runAsync(span, async () => ...)`.
- Use `SpanContext.run` for sync work and `SpanContext.getCurrent()` for parents.
- Provider package span types are always package-prefixed (`<package>:*`).
- Do not normalize provider spans to core enum literals; keep package-specific values like `langchain:agent`, `langchain:llm`, `langchain:tool`, `ai-sdk:agent`, `ai-sdk:llm`, and `ai-sdk:tool`.
- AGENT spans are emitted immediately and later finished (`finishSpan` path).
- Do not break parent/child relationships; always execute child work inside context.
- Ensure LLM/tool spans capture inputs/outputs and token usage when available.

## Transport and queue conventions
- Transport implementations must be resilient and never crash user apps.
- Use queue actions from `packages/core/src/queue/actions.ts`.
- HTTP transport maintains SDK span_id -> backend span_id mapping.
- Queue processing is single-threaded; avoid blocking loops.
- Do not introduce worker threads unless explicitly requested.

## LangChain instrumentation notes
- Middleware uses the modern LangChain middleware API only (no legacy callbacks).
- Keep `any` in middleware with biome-ignore because provider payloads vary.
- Wrap model/tool handlers in `SpanContext.runAsync` to propagate context.
- Capture only the last few messages for inputs/outputs (see middleware).

## AI SDK instrumentation notes
- The AI SDK middleware supports both non-streaming and streaming calls.
- Streaming handlers wrap the stream to finish spans on completion/cancel.
- Tool calls may be derived from `result.toolCalls` or content parts.

## Config and env vars
- Config is defined in `packages/core/src/config.ts` using Zod.
- Prefer adding new settings with env var fallbacks.
- Existing env vars include `PREFACTOR_TRANSPORT`, `PREFACTOR_API_URL`, `PREFACTOR_API_TOKEN`.
- Sampling and capture flags: `PREFACTOR_SAMPLE_RATE`, `PREFACTOR_CAPTURE_INPUTS`, `PREFACTOR_CAPTURE_OUTPUTS`.
- Payload limits: `PREFACTOR_MAX_INPUT_LENGTH`, `PREFACTOR_MAX_OUTPUT_LENGTH`.
- Logging: `PREFACTOR_LOG_LEVEL`.

## Serialization utilities
- Use `serializeValue` and `truncateString` for large payloads.
- Keep payloads JSON-safe; avoid circular structures.

## Tests
- Tests live under `packages/<pkg>/tests` and mirror `src/` structure.
- Bun test API is Jest-like; prefer clear test names.
- Use mock transports (see core transport tests) for tracing behavior.
- For async context tests, wrap execution in `SpanContext.runAsync`.

## Examples and scripts
- Run basic example: `bun examples/basic.ts`.
- Run Anthropic example: `bun examples/anthropic-agent/simple-agent.ts`.
- Run AI SDK example: `bun examples/ai-sdk/simple-agent.ts`.

## Docs and comments
- Use JSDoc for public classes/functions and non-obvious behavior.
- Keep comments short; avoid restating code.
- Update README only if public usage changes.

## Repo policies
- Do not add secrets or tokens to the repo.
- Maintain backward compatibility for public APIs unless explicitly asked.
- Avoid breaking changes in span schemas without coordination.
- Keep examples in `examples/` runnable with Bun.

## Worktree and merge workflow
- When merging worktree changes, merge into the current root branch (do not assume `main`).
- Ensure the root worktree is clean before merging; stash or resolve local changes first.
- Resolve merge conflicts immediately, then stage all resolved files and commit the merge.
- Remove the worktree after a successful merge and delete the feature branch.

## Publishing (do not run unless asked)
- Publish uses `mise run publish` or `mise run publish-dry`.
- Publishing runs per-package `bun publish` in dependency order.

## Cursor/Copilot rules
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` found.
