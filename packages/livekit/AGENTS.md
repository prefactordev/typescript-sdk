# AGENTS.md

## Scope
This file applies to `packages/livekit`.

## Package purpose
`@prefactor/livekit` integrates Prefactor observability with LiveKit Agents.
It traces `voice.AgentSession` lifecycle events, conversation turns, function tool executions,
component metrics, usage updates, and session errors.
This package depends on `@prefactor/core` for tracing infrastructure and should remain a thin
LiveKit-specific adapter.

## Before making changes
- Read `src/provider.ts`, `src/session.ts`, `src/schema.ts`.
- Preserve existing public exports from `src/index.ts` unless the task requires a public API change.
- Check whether reusable tracing, schema normalization, serialization, lifecycle, or queue behavior
  belongs in `@prefactor/core` before implementing package-local logic.
- Treat LiveKit event payloads as external data. Use runtime checks and `unknown` narrowing rather
  than assuming exact payload shapes.

## Architecture rules
- This package should stay an event-driven LiveKit adapter over shared Prefactor primitives.
- Keep the provider small: `PrefactorLiveKit` creates session tracers, normalizes schemas, tracks
  active session tracers for shutdown, and exposes SDK metadata.
- Keep session behavior in `PrefactorLiveKitSession`; do not move LiveKit event handling into the
  provider.
- Keep reusable schema/tool-span normalization in `@prefactor/core` when it is not LiveKit-specific.
- Do not duplicate core tracing, transport, serialization, or agent instance logic locally.

## Integration points
- LiveKit integration is manual and session-scoped:
  - `PrefactorLiveKit.createMiddleware()` returns `createSessionTracer()`.
  - `PrefactorLiveKitSession.attach(session)` binds listeners and opens the root session span.
  - `PrefactorLiveKitSession.start(session, startOptions)` attaches, records agent class metadata,
    delegates to `session.start()`, and finalizes the root span if start fails.
  - `PrefactorLiveKitSession.close()` finalizes the session and unbinds listeners.
- Bound session events include:
  - `user_input_transcribed`
  - `conversation_item_added`
  - `function_tools_executed`
  - `session_usage_updated`
  - `agent_state_changed`
  - `user_state_changed`
  - `speech_created`
  - `error`
  - `close`
- Component metrics are collected from `session.llm`, `session.stt`, and `session.tts` emitters via
  `metrics_collected` when those component emitters expose `on` and `off`.
- Do not bind deprecated root-session `metrics_collected` events.

## Span conventions
This package uses package-prefixed span types:
- `livekit:session`
- `livekit:user_turn`
- `livekit:assistant_turn`
- `livekit:tool`
- `livekit:llm`
- `livekit:stt`
- `livekit:tts`
- `livekit:state`
- `livekit:error`

Rules:
- Preserve package-prefixed span naming.
- Do not collapse these span types into generic core enum values.
- `spanType` is used for schema categorization and analytics.
- `name` is used as a display label in traces.
- Do not change existing span names or meanings without updating schema definitions, templates,
  session behavior, tests, and any affected public behavior.
- Tool-specific span types must resolve through schema normalization and fall back to `livekit:tool`.

## Session lifecycle
- The root `livekit:session` span opens on attach and is the parent for turns, tools, metrics, state,
  and error spans.
- Session event handling is serialized through the internal promise chain. Preserve this ordering so
  LiveKit events do not race each other.
- `close()` must be idempotent.
- Provider shutdown must close all created session tracers and must not throw because a tracer failed
  to close.
- Instrumentation failures should be logged and swallowed; user session behavior should continue.
- When wrapping user/session calls, rethrow the original user-facing error after recording failure
  state.
- Always unbind LiveKit listeners during finalization.

## Conversation and metrics behavior
- User turns come from final transcription events and user state transitions.
- Assistant turns come from speech creation, assistant conversation items, and agent state changes.
- Function tool spans should be parented under the active assistant turn when available, otherwise
  under the root session span.
- Usage updates should update the root session result summary.
- LLM, STT, and TTS metrics should emit component-specific child spans, not mutate deprecated session
  metrics events.
- Keep payloads JSON-safe with `serializeValue` and local defensive serializers where needed.

## Schema conventions
- Default schemas live in `src/schema.ts` and are exported from `src/index.ts`.
- The default schema uses `span_type_schemas`, not legacy `span_schemas` maps.
- `normalizeAgentSchema()` accepts current `span_type_schemas` input and returns
  `span_type_schemas`; do not reintroduce legacy `span_schemas`/`span_result_schemas`
  compatibility without a concrete client requirement.
- `normalizeAgentSchema()` must return at most one `span_type_schemas` entry for each `name`.
  When `toolSchemas` would generate a tool-specific span type that already exists in
  user-provided `span_type_schemas`, keep the user-provided schema and do not append a generated
  duplicate.
- If a user-provided `span_type_schemas` entry overrides a built-in LiveKit span type without a
  `result_schema`, preserve the built-in result schema for that span type. Only replace it when the
  user provides an explicit `result_schema`.
- Templates are part of the tracing contract. If a result field is used in a template, keep runtime
  span outputs aligned with it.
- Never use `additionalProperties: false` to block provider noise. LiveKit payloads are expected to
  evolve.

## Key files
- `src/index.ts`: public exports and package documentation
- `src/provider.ts`: `PrefactorLiveKit` provider, middleware creation, shutdown, default schema
- `src/session.ts`: LiveKit session tracer, event binding, span lifecycle, payload extraction
- `src/schema.ts`: default span schemas, templates, tool schema normalization
- `src/types.ts`: public LiveKit middleware and schema types
- `src/version.ts`: generated package metadata; do not edit manually

## Change rules
- If changing span types, update schemas, templates, event handling, and tests together.
- If changing LiveKit event handling, add or update tests for span parentage, final outputs, and
  error/finalization behavior.
- If changing schema normalization, cover current `span_type_schemas` behavior and tool-specific
  span mappings, including duplicate-name prevention and result-schema preservation for built-in
  overrides.
- If changing public exports, update `src/index.ts` and package docs as needed.
- If changing behavior that depends on built output, run build before affected tests.
- Do not edit `src/version.ts` directly; use the repository version generation flow.

## Testing guidance
- Prefer targeted tests:
  - `bun test packages/livekit/tests/session.test.ts`
  - `bun test packages/livekit/tests/schema.test.ts`
  - `bun test packages/livekit/tests/provider.test.ts`
- Focus tests on lifecycle behavior, parent/child span relationships, event ordering, listener
  cleanup, schema normalization, side effects, and error handling.
- Do not write tests for behavior guaranteed by the type system.

## Never do
- Do not add speculative LiveKit span types or event bindings.
- Do not move shared tracing logic out of core into this package.
- Do not change public exports from `src/index.ts` casually.
- Do not make instrumentation errors crash user LiveKit sessions.
- Do not make `close()` non-idempotent.
- Do not bind root-session `metrics_collected` events.
- Do not change span naming semantics without a deliberate migration path.
