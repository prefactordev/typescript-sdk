# Instrumentation Checklist

## Pre-Integration

- Bootstrap Prefactor resources with CLI (`profile`, `environment`, `agent`, `agent-instance`).
- Confirm which package to use first: `@prefactor/langchain`, `@prefactor/ai`, or `@prefactor/openclaw`.
- Use `@prefactor/core` only if adapter hooks cannot cover required boundaries.
- Identify top-level agent execution boundary and child LLM/tool boundaries.

## CLI Bootstrap Commands

CLI setup notes:

- Install `prefactor` from [prefactordev/cli](https://github.com/prefactordev/cli) (`curl -fsSL https://raw.githubusercontent.com/prefactordev/cli/main/install.sh | bash`, or `install.ps1` on Windows).
- Config resolution is directory-sensitive: `prefactor.json` at the root of the current repository is used before `~/.prefactor/prefactor.json`.
- Select profile with `--profile <name>` when needed.

```bash
prefactor profiles add default [base-url] --api-token <api-token>
prefactor accounts list
prefactor environments create --name <env-name> --account-id <account-id> --purpose development
prefactor agents create --name <agent-name>
prefactor agent-instances register \
  --agent-id <agent-id> \
  --environment-id <environment-id> \
  --agent-version-external-identifier <agent-version-id> \
  --agent-version-name <agent-version-name> \
  --agent-schema-version-external-identifier <schema-version-id> \
  --update-current-version
```

Security checks after profile creation:

```bash
git check-ignore prefactor.json
git status --short
```

If no built-in adapter exists for the target provider, use `skills/create-provider-package-with-core/SKILL.md`.

## Integration

- For adapter-based integrations, import `init`, `withSpan`, and `shutdown` from the same package (`@prefactor/langchain` or `@prefactor/ai`) instead of mixing with `@prefactor/core`.
- If you must mix packages, pass an explicit tracer to core `withSpan` (`withSpan(getTracer(), options, fn)`).
- Scope note: this same-package tracer guidance applies to adapter-style integrations, not the `@prefactor/openclaw` plugin runtime.
- Add one top-level run/agent span per execution.
- Add child spans around each LLM call and each external tool invocation.
- Ensure child operations execute inside active context propagation.
- Keep custom span types package-prefixed (`langchain:*`, `ai-sdk:*`, or `openclaw:*`).
- Capture token usage and model metadata when available.
- Capture inputs/outputs with truncation and redaction enabled.

## Same-Package Tracer Verification

Add these checks to prevent manual custom spans from being dropped:

```bash
# check imports come from one adapter package
rg "import\s*\{[^}]*\b(init|withSpan|shutdown)\b[^}]*\}\s*from\s*'@prefactor/" src

# optionally flag direct core helper imports in adapter integrations
rg "import\s*\{[^}]*\b(withSpan|shutdown)\b[^}]*\}\s*from\s*'@prefactor/core'" src
```

Smoke check in telemetry:

- Add one manual custom span with `withSpan(...)` in app code.
- Execute one real request.
- Confirm the manual custom span appears under the expected run tree.

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

## Troubleshooting Matrix

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| only `ai-sdk:llm` appears | middleware tool spans are active but manual spans are not connected to the active tracer | set `captureTools: false` and use manual `withSpan` from `@prefactor/ai` (same adapter package as `init`) |
