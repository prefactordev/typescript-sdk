# Instrumentation Checklist

## Pre-Integration

- Bootstrap Prefactor resources with CLI (`profile`, `environment`, `agent`, `agent_instance`).
- Confirm which package to use first: `@prefactor/langchain`, `@prefactor/ai`, or `@prefactor/openclaw`.
- Use `@prefactor/core` only if adapter hooks cannot cover required boundaries.
- Identify top-level agent execution boundary and child LLM/tool boundaries.

## CLI Bootstrap Commands

CLI setup notes:

- `prefactor` comes from `@prefactor/cli`; if not globally installed, use launcher commands such as `bunx @prefactor/cli` or `npx @prefactor/cli`.
- Run from a known config directory (recommended: repo root) because config resolution is directory-sensitive (`./prefactor.json` before `~/.prefactor/prefactor.json`).
- Select profile with `--profile <name>` when needed.

```bash
prefactor profiles add default [base-url] --api-token <api-token>
prefactor accounts list
prefactor environments create --name <env-name> --account_id <account-id>
prefactor agents create --name <agent-name> --environment_id <environment-id>
prefactor agent_instances register \
  --agent_id <agent-id> \
  --agent_version_external_identifier <agent-version-id> \
  --agent_version_name <agent-version-name> \
  --agent_schema_version_external_identifier <schema-version-id> \
  --update_current_version
```

Security checks after profile creation:

```bash
git check-ignore prefactor.json
git status --short
```

If no built-in adapter exists for the target provider, use `skills/create-provider-package-with-core/SKILL.md`.

## Integration

- Add one top-level run/agent span per execution.
- Add child spans around each LLM call and each external tool invocation.
- Ensure child operations execute inside active context propagation.
- Keep custom span types package-prefixed (`langchain:*`, `ai-sdk:*`, or `openclaw:*`).
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
