# @prefactor/cli

Command-line interface for managing Prefactor resources from your terminal.

## Installation

```bash
npm install @prefactor/cli
# or
bun add @prefactor/cli
```

Run with `npx`:

```bash
npx @prefactor/cli --help
```

Or install globally:

```bash
npm install --global @prefactor/cli
prefactor --help
```

## Quick Start

1. Create a profile with your API token:

```bash
prefactor profiles add default --api-token <api-token>
```

2. Verify access:

```bash
prefactor accounts list
```

3. Run other resource commands:

```bash
prefactor environments list
prefactor agents list --environment_id <environment_id>
```

## Authentication and Profiles

The CLI reads credentials from profiles stored in `prefactor.json`:

- Uses `./prefactor.json` when present in the current directory.
- Otherwise uses `~/.prefactor/prefactor.json` when available.
- If neither exists, creating a profile writes `./prefactor.json`.

Select a profile with either:

- Global flag: `--profile <name>`
- Environment variable: `PREFACTOR_PROFILE=<name>`

Environment fallback is supported when no default profile is configured:

- `PREFACTOR_API_TOKEN`
- `PREFACTOR_API_URL` (defaults to `https://app.prefactorai.com`)

## Command Groups

- `profiles`: add, list, and remove CLI profiles
- `accounts`: list, retrieve, update
- `environments`: list, retrieve, create, update, delete
- `agents`: list, retrieve, create, update, delete, retire, reinstate
- `agent_versions`: list, retrieve, create
- `agent_schema_versions`: list, retrieve, create
- `agent_instances`: list, retrieve, register, start, finish
- `agent_spans`: list, create, finish, create_test_spans
- `api_tokens`: list, retrieve, create, suspend, activate, revoke, delete
- `admin_users` and `admin_user_invites`: admin management commands
- `pfid` and `bulk`: utility commands

Run `prefactor <command> --help` for command-specific options.

## JSON File Input

Some options accept JSON directly or from a file using `@path` syntax:

```bash
prefactor bulk execute --items @./bulk-items.json
prefactor agent_spans create --payload @./span.json
```

## Requirements

- Node.js >= 22.0.0

## License

MIT
