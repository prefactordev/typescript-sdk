# Custom Provider Checklist (Core-First)

## Create Adapter Module

- Create a dedicated module/package (for example `prefactor-provider-<provider>`).
- Add `src/index.ts` and a provider wrapper file.
- Add tests or smoke scripts for telemetry behavior.

## Adapter Implementation

- Add `@prefactor/core` dependency.
- Keep adapter thin (translation + provider hooks only).
- Reuse core utilities for context propagation and tracing lifecycle.
- Use provider-prefixed span types (`<provider>:agent|llm|tool`).
- Record failures and rethrow original errors.

## Validate Behavior

- Parent/child span linkage is preserved.
- Success path spans finish correctly.
- Error path spans finish correctly.
- Streaming finish/cancel/error paths complete spans.
- Input/output capture follows payload limits.
- Secret values are redacted before transport emission.

## Verification Commands (Example)

Run the equivalent commands for your project/toolchain, such as:

```bash
bun run build
bun test
bun run typecheck
bun run lint
```

## Done Criteria

- Reusable tracing logic stays in `@prefactor/core`.
- Public exports are intentional and minimal.
- Verification commands pass and one real run emits expected telemetry.
