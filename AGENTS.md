# AGENTS.md

This file provides repository-wide instructions for coding agents working in this repo.

## Scope and precedence
This file applies across the repository unless a more specific `AGENTS.md` exists in a subdirectory.

When working in a subdirectory:
1. Read this root file first.
2. Read the nearest relevant `AGENTS.md` before making changes.
3. If instructions conflict, follow the more specific `AGENTS.md` for that area.

## Repository overview
- This is a monorepo using Bun workspaces under `packages/*`.
- Do not assume the set of packages in this repo is fixed.
- Source code typically lives in `packages/<pkg>/src`.
- Tests typically live in `packages/<pkg>/tests`.
- Build outputs typically go to `packages/<pkg>/dist`.
- Root examples live under `examples/`.
- Use `mise` for toolchain management.

## Package discovery and local guidance
- Packages live under `packages/*`.
- Treat each package as an independently scoped unit with its own local conventions where applicable.
- Before editing code in any package, inspect that package’s directory structure, exports, dependencies, tests, and local docs.
- Before editing code in any package, check whether that package or one of its parent subdirectories contains a local `AGENTS.md`.
- If no local `AGENTS.md` exists, rely on this root file and the package’s existing code, tests, and local documentation.

## Work loop
Follow this process for all non-trivial changes:

1. Identify the affected package or packages.
2. Read the nearest relevant `AGENTS.md` and any package-local guidance before editing code.
3. Inspect the existing implementation and tests before introducing new abstractions.
4. Add or update tests when behavior changes.
5. Make the smallest change necessary to satisfy the current requirement.
6. Run targeted validation first.
7. Run broader validation if the change affects shared behavior, public exports, build output, configuration, or cross-package integration.
8. Do not treat the task as complete while relevant checks are failing.

## Architecture and package roles

### Shared-first philosophy
- Put shared behavior, data shaping, lifecycle helpers, instrumentation, serialization, config handling, and reusable utilities in shared infrastructure packages.
- Keep adapter packages thin and focused on provider-specific or integration-specific behavior.
- Before adding logic to a package, check whether it belongs in a shared package instead.
- Avoid duplicate implementations across packages; extract shared logic first, then adapt locally where needed.
- Default design decisions to this shared-first approach unless a package-specific constraint requires local behavior.
- Implement only the minimum behavior needed for current requirements.
- Map implementation directly to current requirements; avoid speculative abstractions.

### Inferring package role
- Some packages provide shared internal infrastructure used by other packages.
- Other packages act as thin adapters over external SDKs, APIs, frameworks, or providers.
- Infer a package’s role from its exports, dependencies, tests, and local documentation.
- If behavior is reusable across multiple packages, it likely belongs in shared infrastructure.
- If behavior exists only to adapt one external system, it likely belongs in that package.
- Respect package boundaries and existing dependency direction.

## General coding rules

### Code quality and style
- Do not add default fallbacks during the development phase. If something fails, let it fail so the real issue can be fixed.
- Do not leave empty try-catch blocks anywhere.
- Do not add optional, speculative, future-use code, APIs, schemas, configs, or examples unless explicitly requested.
- Prefer `getLogger('namespace')` for structured logs where a logger is available.

### Error handling and logging
- Instrumentation must never throw new errors; log and continue.
- If wrapping user code, rethrow the original error after recording spans.
- Use `console.error` only where a package logger is not available.
- Keep error payloads consistent with `ErrorInfo` shape: type, message, stacktrace.
- Do not let logging throw; guard against missing or malformed data.

### Types and data shapes
- Prefer `unknown` to `any`; narrow with runtime checks.
- Use `Record<string, unknown>` for generic payloads.
- Use explicit return types for public APIs and async methods, for example `: Promise<void>`.
- When parsing JSON, cast with `as { ... }` only when necessary and validate defensively.
- `any` is allowed only where external payloads are truly dynamic.
- If using `any`, include the `biome-ignore` comment explaining why it is necessary.
- Avoid widening to `object`; prefer structured types or `Record<string, unknown>`.

### Naming and file layout
- Files use kebab-case, for example `instance-manager.ts`.
- Classes and enums use PascalCase.
- Functions and variables use camelCase.
- Constants use UPPER_SNAKE_CASE, for example `MODEL_SETTINGS`.
- Public exports belong in each package’s `src/index.ts`.
- Preserve package boundaries and existing dependency direction.

## Tracing and context rules
- Context propagation relies on `AsyncLocalStorage` wrappers.
- Wrap async work in `SpanContext.runAsync(span, async () => ...)`.
- Use `SpanContext.run` for sync work.
- Use `SpanContext.getCurrent()` when the current parent span is needed.
- Do not break parent/child relationships; always execute child work inside the correct context.
- AGENT spans are emitted immediately and finished later through the `finishSpan` path.
- Ensure LLM and tool spans capture inputs, outputs, and token usage when available.

### Span naming
- Use package-prefixed span types in the form `<package>:*`.
- Do not normalize package-specific spans to shared enum literals.
- Preserve package-specific naming for agent, model, and tool operations.

## Schemas and templates
- Schemas are the tracing contract for an agent or provider integration. They define which span types exist, what payload shape each span is allowed to send, and what result shape it is allowed to finish with.
- In this repo, schemas are not decorative metadata. They are how the SDK tells Prefactor what a `langchain:llm`, `ai-sdk:tool`, `livekit:user_turn`, or custom app span means.
- We need schemas so spans are interpretable, queryable, and stable across SDK versions. Without them, traces degrade into unstructured blobs that are harder to validate, summarize, search, and evolve safely.
- Schemas also protect compatibility. If instrumentation changes the payload shape without coordinating the schema, the HTTP transport can hit schema drift or backend validation issues.
- Treat schema changes as API changes for observability. If you change a span's meaning, payload keys, result keys, or required fields, coordinate that change and update identifiers/versioning when appropriate.
- Keep schemas minimal and requirement-driven. Include fields that explain the unit of work, drive summaries, support debugging, or are needed for downstream queries; do not add speculative fields.
- Prefer stable, human-readable field names. Use names that describe intent (`model`, `tool_name`, `token_usage`, `finish_reason`) rather than transient implementation details.
- Prefer explicit object schemas with `properties`, `required`, and `additionalProperties` choices that match real runtime behavior. Do not mark fields required unless instrumentation can reliably provide them.
- Keep params and result schemas aligned with runtime lifecycle. Inputs belong in params/payload; outputs, status details, and usage belong in result payloads.
- Reuse existing provider span types when the meaning matches. Add a new span type only when the work is materially different, not just because the call site is different.
- Keep provider-prefixed naming consistent for custom span types. Follow the existing package namespace pattern instead of inventing cross-package generic names.
- Tool-specific schemas should be specific enough to describe the tool contract, but still resilient to provider noise. Prefer narrow input schemas and pragmatic output schemas.
- When evolving default schemas, preserve backward compatibility where possible and avoid silent breakage for existing users relying on current span names or shapes.

- Templates are short human-readable summary strings attached to span schemas. They turn structured params/result fields into a concise sentence or phrase in the Prefactor UI.
- We need templates because raw JSON payloads are slow to scan. A good template makes traces understandable at a glance without opening the full payload.
- A template should summarize what happened, not restate the whole schema. It is for quick triage and navigation, not exhaustive detail.
- Keep templates short, concrete, and field-driven. Good examples mention the action, the main subject, and optionally the outcome.
- Prefer templates that use stable high-signal fields such as model name, tool name, query, target, result count, or finish status.
- Do not depend on noisy, huge, or highly variable fields in templates. Avoid dumping full prompts, full outputs, or arbitrarily large content into summaries.
- Write templates so they still read reasonably when optional fields are absent. Do not build templates that become misleading or unreadable if one field is missing.
- Use templates to distinguish similar spans in lists. If two span types would otherwise look identical in the UI, improve the template before adding more fields.
- Keep templates semantically aligned with the schema. If the template references `result_count`, that field must be consistently populated by the runtime instrumentation.
- Update templates when span meaning changes, and update schemas if the template needs new structured fields. Do not patch observability gaps with template text alone.

## Transport and queue conventions
- Transport implementations must be resilient and must never crash user apps.
- Use queue actions from `packages/core/src/queue/actions.ts` when working in code paths that rely on the shared queue implementation.
- HTTP transport maintains SDK `span_id` to backend `span_id` mapping where applicable.
- Queue processing is single-threaded; avoid blocking loops.
- Do not introduce worker threads unless explicitly requested.

## Streaming and instrumentation notes
- Middleware may support both non-streaming and streaming calls.
- Streaming handlers should wrap the stream and finish spans on completion or cancel.
- Tool calls may be derived from structured tool call fields or content parts, depending on the integration.

## Serialization utilities
- Use `serializeValue` and `truncateString` for large payloads where those utilities exist.
- Keep payloads JSON-safe.
- Avoid circular structures in serialized output.

## Config and environment variables
- Shared config is defined in `packages/core/src/config.ts` using Zod.
- Prefer adding new settings with environment variable fallbacks.
- Existing environment variables include:
  - `PREFACTOR_API_URL`
  - `PREFACTOR_API_TOKEN`
  - `PREFACTOR_SAMPLE_RATE`
  - `PREFACTOR_CAPTURE_INPUTS`
  - `PREFACTOR_CAPTURE_OUTPUTS`
  - `PREFACTOR_MAX_INPUT_LENGTH`
  - `PREFACTOR_MAX_OUTPUT_LENGTH`
  - `PREFACTOR_LOG_LEVEL`

## Docs and comments
- Use JSDoc for public classes, public functions, and non-obvious behavior.
- Keep comments short and useful.
- Do not restate what the code already makes obvious.
- Update README only if public usage changes.

## Change scope rules
- If shared behavior changes, update the shared implementation first, then adapt package-specific code as needed.
- If a public export changes, update the package’s `src/index.ts`.
- If config or environment behavior changes, update config definitions and related docs together.
- If tests rely on built output, run build before running those tests.
- If a change affects multiple packages, validate the dependency chain, not only the package where the edit was made.

## Command locality
- Run repository-wide commands from the repo root.
- Prefer targeted package commands before running full-repo checks.
- Verify the current working directory before running broad or destructive commands.

## Build, lint, format, typecheck, and test

### Repository-wide commands
- Build all: `mise run build` or `bun run build`
- Lint: `mise run lint` or `bun run lint`
- Format: `mise run format` or `bun run format`
- Typecheck: `mise run typecheck` or `bun run typecheck`
- Tests (all): `mise run test` or `bun test`
- Tests (watch): `mise run test-watch` or `bun test --watch`

### Targeted and filtered commands
- Build with filter: `bun run scripts/build.ts --filter <package-name>`
- Single test file: `bun test packages/<pkg>/tests/<path-to-test-file>`
- Single test by name: `bun test --test-name-pattern "test name"`
- Package test folder: `bun test packages/<pkg>/tests/`

### CI
- CI runs lint, typecheck, test, and build.
- See `.github/workflows/ci.yml`.

### Build ordering
- Always run `bun run build` before tests or other checks that require built packages.

## Testing guidance
- Tests live under `packages/<pkg>/tests` and should mirror `src/` structure where practical.
- Bun test API is Jest-like; prefer clear, descriptive test names.
- Use mock transports where appropriate, especially for tracing behavior.
- For async context tests, wrap execution in `SpanContext.runAsync`.

## Done criteria
Do not consider work complete until all applicable items below are true:
- Relevant local guidance was read before changing code in that area.
- Tests were added or updated when behavior changed.
- Relevant build steps pass.
- Relevant typecheck passes.
- Relevant test targets pass.
- Public API docs or README updates were made if public usage changed.

## Desloppify after major changes
After completing a significant change, run the `desloppify` skill to check for technical debt introduced by your changes specifically. Report back only issues that were brought in by this change, not pre-existing issues in the codebase. Ground all observations to the diff of what was modified in this branch - both committed and uncommitted.

If the user doesn't have the desloppify cli installed, refer to the `INSTALL.md` for the desloppify skill.

## Never do
- Do not commit changes unless explicitly asked.
- Do not publish packages, even if requested.
- Do not add speculative abstractions, future-only hooks, or placeholder implementations unless explicitly requested.
- Do not write tests for behavior guaranteed by the type system (e.g., type narrowing, null checks, basic input validation). Focus tests on lifecycle behavior, correctness of side effects, and data validity.

## Versioning
When bumping versions, always check the lockfile and verify dependency changes are intentional. Run a full build after version bumps to ensure the change is correct.

## Creating new packages
When creating a new provider package (e.g., for a new AI framework):
1. Read existing provider packages (`packages/ai`, `packages/langchain`) to understand patterns
2. Follow their architecture: thin adapter over `@prefactor/core`
3. Use their test patterns and structure as a template
4. Check what conventions exist in neighboring packages before establishing new ones