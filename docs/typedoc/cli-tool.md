# CLI Tool

`@prefactor/cli` is the terminal tool for working with Prefactor APIs without writing code.
It is documented here as a **tool guide** (not as a generated package API module).

## What You Can Do with the CLI

Use the CLI to manage the main Prefactor resource families and utility workflows:

- Profiles and authentication (`profiles`)
- Accounts, environments, agents, and versions
- Agent instances and spans
- API tokens and admin invites
- Utility flows such as PFID generation and bulk API requests

Use `prefactor help` or `prefactor <group> help` for full command details.

## Before You Start

You need:

- A Prefactor API token from the web interface scoped to the account level
- A working directory where you intend to keep config (recommended: your repo root)

Install and run:

```bash
npm install @prefactor/cli
# or
bun add @prefactor/cli

npx @prefactor/cli help
```

You can also install globally:

```bash
npm install --global @prefactor/cli
# or
bun add --global @prefactor/cli

prefactor help
```

## Profile Setup (Required)

Most commands require an authenticated profile.

### Command definition

```bash
prefactor profiles add <profile-name> [base-url] --api-token <token>
```

- `<profile-name>`: profile key (for example, `default`, `staging`, `prod`)
- `[base-url]`: optional API base URL; defaults to `https://app.prefactorai.com`
- `--api-token <token>`: required API token for that profile

Examples:

```bash
# Use default API URL
prefactor profiles add default --api-token <token>

# Use a custom API URL
prefactor profiles add staging https://staging.prefactorai.example --api-token <token>
```

Select profiles with:

- Global flag: `--profile <name>`

## Where Config Is Stored (`prefactor.json`)

The CLI resolves config in this order:

1. `./prefactor.json` (current working directory)
2. `~/.prefactor/prefactor.json`
3. If neither exists, creating a profile writes `./prefactor.json`

That means the current directory matters for both reads and writes.

Typical file shape:

```json
{
  "default": {
    "api_key": "<token>",
    "base_url": "https://app.prefactorai.com"
  }
}
```

## Global Install Caveat (Important)

A global install does **not** make config global by itself. The CLI still resolves
`prefactor.json` from the directory you run it in first.

Practical drawbacks:

- Running from the wrong folder can use the wrong profile file
- Running in a random folder can create a new local `prefactor.json`
- Context switching between repos can accidentally switch credentials

Best practice: run CLI commands from a known repo root (or a known config directory).

## Security and Git Hygiene

`prefactor.json` contains API tokens. Treat it as a secret file.

- Do not commit `prefactor.json`
- The CLI attempts to add `prefactor.json` to local `.gitignore` automatically **when**:
  - config is local (`./prefactor.json`), and
  - current directory is a git repository
- Still verify manually (especially in monorepos or custom git setups)

Recommended checks:

```bash
git check-ignore prefactor.json
git status --short
```

## Quick Workflow Example

```bash
# 1) Authenticate
prefactor profiles add default --api-token <token>

# 2) List profiles
prefactor profiles list

# 3) Drill into resources
prefactor environments list --account_id <account_id>
prefactor agents list --environment_id <environment_id>
```

## Environment Variable Fallback

If no matching profile exists for the default selection, the CLI can fall back to:

- `PREFACTOR_API_TOKEN`
- `PREFACTOR_API_URL`

This fallback is useful for CI or short-lived local runs, but named profiles are better for
day-to-day usage.

## JSON Input from Files

Some commands accept JSON values directly or from files using `@path` syntax:

```bash
prefactor bulk execute --items @./bulk-items.json
prefactor agent_spans create --payload @./span.json
```

This helps keep large payloads readable and reviewable.
