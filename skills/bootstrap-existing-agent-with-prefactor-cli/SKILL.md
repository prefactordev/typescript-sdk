---
name: bootstrap-existing-agent-with-prefactor-cli
description: Use when Prefactor resources and runtime credentials need to be provisioned via the Prefactor CLI before SDK instrumentation is added.
---

# Bootstrap agent with Prefactor CLI

Provision Prefactor credentials with the CLI before changing application code.

Core principle: provision first, instrument second.

## Coding assistant usage

Apply this skill first when the user asks to:

- "set up Prefactor for this agent"
- "register a Prefactor agent and get env vars"
- "use the CLI to bootstrap Prefactor"
- "prepare IDs and env vars before instrumentation"

After this skill completes:

1. If the provider is supported, continue with `skills/instrument-existing-agent-with-prefactor-sdk/SKILL.md`.
2. If the provider is unsupported, continue with `skills/create-provider-package-with-core/SKILL.md`.
3. Hand off the setup env values and the selected package.

## Prerequisites

- The Prefactor CLI is installed (`prefactor` on PATH, or via `npx @prefactor/cli`).
- The human has already run `prefactor login` in a real terminal.
- You are working in the project root (or the directory that should receive env values).

Do not run `prefactor login`, `prefactor profiles add`, or invent API tokens. If setup fails because the CLI is not signed in, stop and ask the human to run `prefactor login`.

## CLI workflow

Use one setup command. Prefer `--json` so you can parse fields reliably.

Existing agent:

```bash
prefactor setup <agent_id> --json
```

New agent:

```bash
prefactor setup --create --name "<short-agent-name>" --description "<short description>" --json
```

`prefactor setup` creates a deployment when needed, mints a deployment-scoped runtime token, validates that token with ping, and prints:

- `api_url`
- `api_token`
- `agent_id`
- `agent_identifier`
- optional `language` and `suggested_package` when the working directory has one clear known framework

Treat setup output as the single source of truth for Prefactor configuration. Do not list accounts, create environments, create API tokens manually, or register agent instances as part of first-run bootstrap.

## Write env values

Add the setup values to the project's existing env pattern (same file type, loading mechanism, and naming conventions as other secrets). Prefer the API-key pattern if several exist.

Map JSON fields to:

```bash
PREFACTOR_API_URL=<api_url>
PREFACTOR_API_TOKEN=<api_token>
PREFACTOR_AGENT_ID=<agent_id>
PREFACTOR_AGENT_IDENTIFIER=<agent_identifier>
```

Do not invent a new secret layout. Do not commit `prefactor.json` (it can contain profile tokens).

## Package selection

Prefer `suggested_package` from setup JSON when present.

Otherwise choose by provider:

- LangChain -> `@prefactor/langchain`
- AI SDK -> `@prefactor/ai`
- OpenClaw -> `@prefactor/openclaw`
- Claude SDK -> `@prefactor/claude`
- Custom/unsupported provider -> use `skills/create-provider-package-with-core/SKILL.md`

Install the chosen package with the project's existing package manager. When handing off to instrumentation, import helpers from that same adapter package.

## Verification

- Setup exited successfully.
- Env values match setup output.
- Package choice matches the provider or setup suggestion.
- `prefactor.json` is not staged for commit.

## Common mistakes

- Instrumenting code before running `prefactor setup`.
- Running `prefactor login` or creating tokens outside setup.
- Ignoring setup JSON and inventing env keys or package names.
- Mixing adapter `init` with `withSpan`/`shutdown` from `@prefactor/core` unless an explicit tracer is passed.
- Committing `prefactor.json`.
