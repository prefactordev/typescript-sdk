# @prefactor/cli

Command-line interface and typed API clients for managing Prefactor resources.

## Installation

```bash
npm install @prefactor/cli
# or
bun add @prefactor/cli
```

Run directly with `npx`:

```bash
npx @prefactor/cli --help
```

Or install globally:

```bash
npm install --global @prefactor/cli
prefactor --help
```

## Quick Start

1. Create a default profile:

```bash
prefactor profiles add default --api-token <api-token>
```

2. Verify access:

```bash
prefactor accounts list
```

3. Query additional resources:

```bash
prefactor environments list --account_id <account_id>
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

- `profiles`: add, list, remove
- `accounts`: list, retrieve, update
- `environments`: list, retrieve, create, update, delete
- `agents`: list, retrieve, create, update, delete, retire, reinstate
- `agent_versions`: list, retrieve, create
- `agent_schema_versions`: list, retrieve, create
- `agent_instances`: list, retrieve, register, start, finish
- `agent_spans`: list, create, finish, create_test_spans
- `api_tokens`: list, retrieve, create, suspend, activate, revoke, delete
- `admin_users`: list, retrieve
- `admin_user_invites`: list, retrieve, create, revoke
- `pfid`: generate
- `bulk`: execute

Run `prefactor <command> --help` for command-specific options.

## JSON File Input

Some options accept JSON directly or from a file using `@path` syntax:

```bash
prefactor bulk execute --items @./bulk-items.json
prefactor agent_spans create --payload @./span.json
```

## Programmatic Usage

`@prefactor/cli` also exports typed clients that can be used directly in scripts.

```typescript
import {
  ApiClient,
  AccountClient,
  EnvironmentClient,
  AgentClient,
} from '@prefactor/cli';

const api = new ApiClient('https://app.prefactorai.com', process.env.PREFACTOR_API_TOKEN!);
const accounts = new AccountClient(api);
const environments = new EnvironmentClient(api);
const agents = new AgentClient(api);

const accountList = await accounts.list();
const accountId = accountList.details[0]?.id;

if (accountId) {
  const envList = await environments.list(accountId);
  const environmentId = envList.details[0]?.id;

  if (environmentId) {
    const agentList = await agents.list(environmentId);
    console.log(agentList.details);
  }
}
```

## API Reference

### CLI Entry Points

- `createCli(version: string): Command`: Creates a configured Commander program instance.
- `runCli(argv: string[]): Promise<void>`: Parses and executes CLI commands.

### Core API Client

- `ApiClient`: Shared HTTP client used by all resource clients.
  - `request(path, options?)`: Sends a request to `/api/v1` with query/body helpers.

### Resource Clients

- `AccountClient`
- `EnvironmentClient`
- `AgentClient`
- `AgentVersionClient`
- `AgentSchemaVersionClient`
- `AgentInstanceClient`
- `AgentSpanClient`
- `ApiTokenClient`
- `AdminUserClient`
- `AdminUserInviteClient`
- `PfidClient`
- `BulkClient`

Each client exposes typed request/response interfaces for its resource operations.

## Requirements

- Node.js >= 22.0.0

## License

MIT
