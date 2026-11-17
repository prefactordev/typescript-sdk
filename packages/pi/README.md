# @prefactor/pi

A [pi](https://pi.dev) extension that records pi sessions in Prefactor. Each pi session becomes one Prefactor agent instance, with spans for its agent runs, LLM responses and tool calls.

> **Sensitive data:** the extension records prompts, completions and tool results as they are, without redaction. Coding sessions often contain source code, credentials and other secrets, so do not use it for sessions that handle data you cannot send to Prefactor.

## Installation

```bash
pi install npm:@prefactor/pi
```

To try it for one run without adding it to your settings:

```bash
pi -e npm:@prefactor/pi
```

## Connect pi to Prefactor

Run this inside pi:

```text
/prefactor setup
```

It signs you in through Prefactor in the browser. pi opens the sign-in page and shows the link, which you can also open yourself, or on another device when pi runs over SSH or in a container, and the code to approve there. You then create an agent for pi, named "pi" unless you choose another name, or pick one of your account's existing agents, and choose the environment when the agent has more than one deployment. Setup creates an agent-deployment token for that agent and environment, checks it, and saves it to `~/.pi/agent/prefactor.json` with file mode `0600`.

The account token from the sign-in is kept in memory only. Setup revokes it once the deployment token is saved, or when setup stops early. If revoking fails, setup keeps the deployment token and tells you to revoke the account token under Account settings in Prefactor.

If the server does not offer browser sign-in, or you choose to, setup asks you to paste an agent-deployment token instead. The token is visible on screen while you paste it.

| Command | Does |
| --- | --- |
| `/prefactor setup` | Connects pi to Prefactor. Asks first when credentials already exist. |
| `/prefactor status` | Shows where the credentials come from, the API URL, the account and agent, and whether the last request to Prefactor succeeded. |
| `/prefactor logout` | Deletes the credentials file. Credentials from code or the environment are not affected. |

The commands need dialogs, so they work in interactive and RPC modes. In print and JSON modes, use the environment variables below.

## Credentials

The extension sends spans with a Prefactor agent-deployment token. When a session starts, it reads credentials from the first of these sources that supplies a token:

1. Options passed to `prefactorExtension()` in code.
2. The environment variables `PREFACTOR_API_URL`, `PREFACTOR_API_TOKEN` and `PREFACTOR_AGENT_ID`.
3. The credentials file written by `/prefactor setup`, `~/.pi/agent/prefactor.json`. It follows pi's `PI_CODING_AGENT_DIR` setting when that is set.

The agent id comes from the same source as the token. When that source has no agent id, the extension reads it from the token with `GET /api/v1/ping`. The API URL comes from the token's source or a later one, and defaults to `https://app.prefactorai.com`.

The credentials file holds `api_url`, `api_token` (the deployment token), `agent_id`, `agent_name`, `environment_id`, `account_id`, `account_name` and `created_at`. It never holds an account token.

When no token is found, the extension records nothing and tells you once how to set Prefactor up, so pi keeps working. In interactive and RPC modes the notice appears in pi. In print and JSON modes it is written to stderr.

## Agents built on pi's SDK

Agents built with `@earendil-works/pi-coding-agent` load the same extension in code through `extensionFactories`, and each session is recorded as one agent instance. Install the package alongside pi:

```bash
npm install @prefactor/pi @earendil-works/pi-coding-agent
```

```typescript
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { prefactorExtension } from '@prefactor/pi';

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({
    cwd,
    resourceLoaderOptions: {
      extensionFactories: [
        prefactorExtension({
          apiUrl: 'https://app.prefactorai.com',
          apiToken: process.env.MY_PREFACTOR_TOKEN,
          agentVersion: '2.3.0',
        }),
      ],
    },
  });
  return {
    ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.inMemory(),
});

try {
  await runtime.session.bindExtensions({});
  await runtime.session.prompt('What files are in the current directory?');
} finally {
  await runtime.dispose();
}
```

`prefactorExtension()` takes these options. Each credential falls back to its environment variable, then to the credentials file, as described under [Credentials](#credentials).

| Option | Meaning |
| --- | --- |
| `apiUrl` | Prefactor API URL |
| `apiToken` | Agent-deployment token |
| `agentId` | Prefactor agent id, read from the token when omitted |
| `agentVersion` | Agent version recorded for each session. Defaults to the version of the pi framework. |

The session lifecycle depends on two calls:

- `session.bindExtensions()` emits `session_start`, which starts the agent instance. Nothing is recorded until it is called.
- `AgentSessionRuntime.dispose()` emits `session_shutdown`, which finishes the agent instance after the remaining spans are sent. `AgentSession.dispose()` on its own does not emit `session_shutdown`, so with `createAgentSession()` the agent instance stays active in Prefactor. Use `AgentSessionRuntime` as above when the instance should be finished.

The `pi` command always records pi's release version, because it loads the extension without options.

## What gets recorded

| Span type | Covers | Recorded |
| --- | --- | --- |
| `pi:session` | One pi session | Session id, working directory, mode, start reason and model; shutdown reason |
| `pi:agent_run` | One agent run, from `agent_start` to `agent_end` | User prompt and images; final response text, stop reason and error |
| `pi:llm` | One assistant message | Provider, model and the messages added to the context since the previous LLM call; content, stop reason, token usage (including cache read and cache write tokens), cost and duration |
| `pi:tool:read`, `pi:tool:write`, `pi:tool:edit`, `pi:tool:bash` | pi's built-in tools | Arguments; result content, details, error flag and duration |
| `pi:tool` | Any other tool | As for the built-in tools |

LLM responses and tool calls are children of their agent run. A tool call made by another tool, such as a codemode script, is a child of that tool's span.

The agent version is pi's release version, or `agentVersion` for agents built on pi's SDK. The working directory on each session lets you tell apart sessions from different repositories that report to the same agent.

Long strings are truncated to `PREFACTOR_MAX_INPUT_LENGTH` and `PREFACTOR_MAX_OUTPUT_LENGTH` characters (10,000 by default).

## Shutdown and Ctrl+C

The session appears in Prefactor as soon as it starts. Each span is sent as soon as it starts or finishes, and the agent instance is finished when pi runs `session_shutdown`.

Pressing Ctrl+C in print, JSON or RPC mode ends pi without running `session_shutdown`. Spans that had already finished are recorded. The open agent run, the session span and the agent instance stay active in Prefactor.

## Examples

- [`examples/pi/print-mode.ts`](../../examples/pi/print-mode.ts) runs `pi` once in print mode with the extension loaded from this repository.
- [`examples/pi/sdk-agent.ts`](../../examples/pi/sdk-agent.ts) builds an agent on pi's SDK and records its session.

## Requirements

- Node.js >= 22.19.0
- pi (`@earendil-works/pi-coding-agent`) 1.1.0 or later. Earlier releases do not report tool call durations, and before 0.99.0 they do not say which tool made a nested tool call. The package declares this minimum in its peer dependencies on `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.

pi supplies `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to the extension, and `pi install` does not install them, so the extension records the version of the pi that runs it. When the extension's own `node_modules` holds a copy of pi, for example when it is loaded with `pi -e` from a checkout of this repository, that copy is imported instead, and its version is recorded.
