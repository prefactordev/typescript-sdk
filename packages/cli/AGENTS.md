# AGENTS.md

## Scope
This file applies to `packages/cli`.

## Package purpose
`@prefactor/cli` provides a command-line interface and typed API clients for managing Prefactor resources.
It allows users to manage accounts, agents, environments, agent versions, instances, spans, API tokens, and more.
This is a consumption tool, NOT shared infrastructure.

## Before making changes
- Read `src/cli.ts`, `src/api-client.ts`, and relevant command files first.
- Preserve existing public exports from `src/index.ts` unless the task requires a public API change.
- This package does NOT share infrastructure with other packages - do not add utilities for others to use.

## Architecture rules
- This package should remain a thin adapter over the Prefactor API.
- Client abstraction: one client per resource, thin wrappers around ApiClient.
- Do NOT add caching, batch operations, or other domain logic without explicit requirement.
- Other packages should NOT depend on this package.

## Command groups
14 command groups:
- `profiles`: Manage CLI authentication profiles
- `accounts`: Manage accounts
- `agents`: Manage agents
- `environments`: Manage environments
- `agent_versions`: Manage agent versions
- `agent_schema_versions`: Manage agent schema versions
- `agent_instances`: Manage agent instances (register, start, finish)
- `agent_spans`: Manage agent spans
- `admin_users`: Manage admin users
- `admin_user_invites`: Manage admin user invites
- `api_tokens`: Manage API tokens
- `pfid`: Generate Prefactor IDs
- `bulk`: Execute bulk API requests
- `version`: Print CLI version

## Client architecture
- **`ApiClient`**: Core HTTP wrapper using `@prefactor/core`'s `HttpClient`
- **Resource Clients**: Thin wrappers (e.g., `AgentClient`, `AccountClient`) with typed methods
- Response format: `{ details: T }` for single items, `{ details: T[] }` for lists

## Profile management
- Storage: `prefactor.json` (local first, then `~/.prefactor/prefactor.json`)
- Priority: CLI `--profile` option → `PREFACTOR_PROFILE` env var → `default` profile
- Env var fallback: `PREFACTOR_API_TOKEN`, `PREFACTOR_API_URL`

## Key files
- `src/index.ts`: public exports (ApiClient, resource clients)
- `src/cli.ts`: Main CLI setup (`createCli()`, `runCli()`)
- `src/bin/cli.ts`: Binary entry point
- `src/api-client.ts`: Core HTTP wrapper
- `src/profile-manager.ts`: Profile management
- `src/commands/`: CLI command implementations
- `src/clients/`: API client classes

## Change rules
- If adding new commands, follow existing patterns in `commands/` and `clients/`.
- If adding new clients, keep them thin - just typed wrappers around ApiClient.
- Do NOT add shared utilities that other packages might need.

## Validation
Run the most targeted checks possible first.
Examples:
- `bun test packages/cli/tests/<path>` if tests exist
- relevant filtered build command
- broader typecheck/build only when needed

## Never do
- Do not add shared infrastructure that other packages depend on.
- Do not add caching, batch operations, or domain logic without explicit requirement.
- Do not make clients anything other than thin wrappers.
- Do not change public exports from `src/index.ts` casually.
- Never use `additionalProperties: false` to block additional data - allow unknown fields to pass through.

## Known issues
- CLI `instance` command does not return actual span count - use `agent_spans` command instead.
