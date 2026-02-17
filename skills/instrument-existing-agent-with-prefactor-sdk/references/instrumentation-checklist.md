# Instrumentation Checklist

## Pre-Integration

- Confirm which package to use first: `@prefactor/langchain` or `@prefactor/ai`.
- Use `@prefactor/core` only if adapter hooks cannot cover required boundaries.
- Identify top-level agent execution boundary and child LLM/tool boundaries.

## Integration

- Add one top-level run/agent span per execution.
- Add child spans around each LLM call and each external tool invocation.
- Ensure child operations execute inside active context propagation.
- Keep span types package-prefixed (`langchain:*` or `ai-sdk:*`).
- Capture token usage and model metadata when available.
- Capture inputs/outputs with truncation and redaction enabled.

## Error + Streaming

- On error, record error metadata and rethrow the original error.
- For streaming, finish spans on completion, cancellation, and failure paths.
- Ensure spans are finished exactly once.

## Verification

Run in order:

```bash
bun run build
bun run typecheck
bun test
```

Then validate one real run in telemetry:

- top-level run appears
- child llm/tool spans appear
- parent/child links are correct
- success and failure terminal states are both recorded

## Fast Debug Hints

- Missing child spans -> check context boundaries around async/tool execution.
- Broken tree -> verify child work runs within active span context.
- Missing final status -> verify `finally` or stream terminal callbacks finish spans.
- High payload volume -> enable truncation/redaction and capture flags.
