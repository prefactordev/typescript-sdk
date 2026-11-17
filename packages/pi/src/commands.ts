import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { Container, Input, SelectList, Text } from '@earendil-works/pi-tui';
import type { HttpRequester } from '@prefactor/core';
import {
  type CredentialsFile,
  DEFAULT_API_URL,
  deleteCredentialsFile,
  getCredentialsFilePath,
  type ResolvedCredentials,
  readCredentialsFile,
  writeCredentialsFile,
} from './credentials.js';
import {
  type DeviceGrant,
  type DeviceLogin,
  type DeviceLoginDeps,
  LoginCancelledError,
  openBrowser,
  pollForDeviceGrant,
  startDeviceLogin,
} from './device-login.js';
import { type AgentSummary, PrefactorApi } from './prefactor-api.js';
import type { StartState } from './prefactor-session.js';

export const DEFAULT_AGENT_NAME = 'pi';
const DEFAULT_AGENT_DESCRIPTION = 'pi coding agent sessions';
const DEPLOYMENT_TOKEN_TYPE = 'api_session_agent_deployment_scope';
const LOGIN_WIDGET = 'prefactor-login';
const SUBCOMMANDS = ['setup', 'status', 'logout'] as const;

const SOURCE_LABELS: Record<ResolvedCredentials['source'], string> = {
  options: 'extension options in code',
  environment: 'PREFACTOR_* environment variables',
  file: 'credentials file',
};

/** What the commands need from the running extension. */
export interface PrefactorCommandHost {
  /** Resolves the credentials the extension would use now. */
  resolveCredentials(): Promise<ResolvedCredentials | undefined>;
  /** The credentials and last request error of the session being recorded, if any. */
  getRecording(): {
    credentials: ResolvedCredentials;
    lastError: unknown;
    startState: StartState;
  } | null;
  /**
   * Starts recording the current session, when it is not recorded yet or its agent instance
   * failed to start.
   */
  startRecording(ctx: ExtensionCommandContext): Promise<void>;
  /** Creates an HTTP requester for an API URL and token. */
  createClient(apiUrl: string, apiToken: string): HttpRequester;
  clientVersion: string;
  loginDeps?: DeviceLoginDeps;
  openBrowser?: (url: string) => void;
}

/**
 * Registers `/prefactor setup`, `/prefactor status` and `/prefactor logout`.
 */
export function registerPrefactorCommand(pi: ExtensionAPI, host: PrefactorCommandHost): void {
  pi.registerCommand('prefactor', {
    description: 'Connect pi to Prefactor: setup, status or logout',
    getArgumentCompletions: (prefix) => {
      const items = SUBCOMMANDS.filter((name) => name.startsWith(prefix.trim())).map((name) => ({
        value: name,
        label: name,
      }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim().split(/\s+/)[0] || 'status';
      if (!ctx.hasUI) {
        process.stderr.write(
          '/prefactor needs interactive or RPC mode. In print and JSON modes, set PREFACTOR_API_URL, PREFACTOR_API_TOKEN and PREFACTOR_AGENT_ID.\n'
        );
        return;
      }

      try {
        if (subcommand === 'setup') {
          await setup(ctx, host);
        } else if (subcommand === 'status') {
          await status(ctx, host);
        } else if (subcommand === 'logout') {
          await logout(ctx, host);
        } else {
          ctx.ui.notify(
            `Unknown subcommand "${subcommand}". Use setup, status or logout.`,
            'error'
          );
        }
      } catch (error) {
        if (error instanceof LoginCancelledError) {
          ctx.ui.notify('Prefactor setup cancelled. Nothing was saved.', 'info');
          return;
        }
        ctx.ui.notify(`Prefactor ${subcommand} failed: ${describe(error)}`, 'error');
      }
    },
  });
}

async function setup(ctx: ExtensionCommandContext, host: PrefactorCommandHost): Promise<void> {
  const current = await host.resolveCredentials();
  if (current) {
    const replace = await ctx.ui.confirm(
      'Replace Prefactor credentials?',
      `pi already has Prefactor credentials from the ${SOURCE_LABELS[current.source]}. Set up new credentials?`
    );
    if (!replace) {
      return;
    }
  }

  const file = await readCredentialsFile();
  const apiUrl = process.env.PREFACTOR_API_URL || file?.api_url || DEFAULT_API_URL;

  const method = await ctx.ui.select('Connect pi to Prefactor', [
    'Sign in with your browser',
    'Paste an agent-deployment token',
  ]);
  if (method === undefined) {
    return;
  }

  const saved =
    method === 'Sign in with your browser'
      ? await setupWithBrowser(ctx, host, apiUrl)
      : await setupWithPastedToken(ctx, host, apiUrl);
  if (!saved) {
    return;
  }

  const active = await host.resolveCredentials();
  if (active && active.source !== 'file') {
    ctx.ui.notify(
      `Saved, but the ${SOURCE_LABELS[active.source]} take precedence over the credentials file.`,
      'warning'
    );
    return;
  }
  await host.startRecording(ctx);

  const recording = host.getRecording();
  if (active && recording && recording.credentials.apiToken !== active.apiToken) {
    ctx.ui.notify(
      recording.startState === 'pending'
        ? 'This session keeps the Prefactor recording it is starting, and switches to the new credentials only if that recording fails to start. New sessions use the new credentials.'
        : `This session keeps recording to ${recording.credentials.apiUrl}, agent ${recording.credentials.agentId ?? '(read from its token)'}. New sessions use the new credentials.`,
      'info'
    );
  }
}

async function setupWithBrowser(
  ctx: ExtensionCommandContext,
  host: PrefactorCommandHost,
  apiUrl: string
): Promise<boolean> {
  const login = await startDeviceLogin(apiUrl, host.clientVersion, host.loginDeps);
  if (login === 'unsupported') {
    ctx.ui.notify(`${apiUrl} does not offer browser sign-in. Paste a token instead.`, 'warning');
    return setupWithPastedToken(ctx, host, apiUrl);
  }

  const grant = await waitForApproval(ctx, host, apiUrl, login);
  const accountApi = new PrefactorApi(host.createClient(apiUrl, grant.access_token));
  try {
    return await createDeploymentCredentials(ctx, host, apiUrl, grant, accountApi);
  } finally {
    await revokeAccountToken(ctx, accountApi);
  }
}

/**
 * Shows the code and link in pi and polls until the sign-in is approved. The user can cancel from
 * a dialog while pi waits. Interactive pi shows the link as a clickable widget; RPC clients
 * receive it as a plain widget line.
 */
async function waitForApproval(
  ctx: ExtensionCommandContext,
  host: PrefactorCommandHost,
  apiUrl: string,
  login: DeviceLogin
): Promise<DeviceGrant> {
  // pi's RPC mode sends only string-array widgets to the client and drops component factories.
  if (ctx.mode === 'tui') {
    ctx.ui.setWidget(LOGIN_WIDGET, (_tui, theme) => loginWidget(theme, login));
  } else {
    ctx.ui.setWidget(LOGIN_WIDGET, [login.verification_uri_complete]);
  }
  (host.openBrowser ?? openBrowser)(login.verification_uri_complete);

  const polling = new AbortController();
  const dialog = new AbortController();
  void ctx.ui
    .select(`Approve code ${login.user_code} in your browser`, ['Cancel sign-in'], {
      signal: dialog.signal,
    })
    .then(() => {
      if (!dialog.signal.aborted) {
        polling.abort();
      }
    });

  try {
    return await pollForDeviceGrant(apiUrl, login, polling.signal, host.loginDeps);
  } finally {
    dialog.abort();
    ctx.ui.setWidget(LOGIN_WIDGET, undefined);
  }
}

/** The part of pi's theme the sign-in widget uses. */
interface WidgetTheme {
  fg(color: 'mdLink', text: string): string;
}

/**
 * The sign-in widget: the full link, broken at the terminal width. Each line is its own complete
 * OSC 8 hyperlink to the full link, so it is clickable wherever the terminal wraps it, and no line
 * is wider than the terminal.
 */
function loginWidget(
  theme: WidgetTheme,
  login: DeviceLogin
): { render(width: number): string[]; invalidate(): void } {
  const url = login.verification_uri_complete;
  return {
    render(width: number): string[] {
      return breakAtWidth(url, width).map((line) => theme.fg('mdLink', hyperlink(url, line)));
    },
    invalidate() {},
  };
}

/** Wraps text in an OSC 8 hyperlink, which terminals that support it make clickable. */
function hyperlink(url: string, text: string): string {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/** Breaks plain single-width text, such as a URL, into lines of at most `width` columns. */
function breakAtWidth(text: string, width: number): string[] {
  const chars = [...text];
  const step = Math.max(1, width);
  const lines: string[] = [];
  for (let start = 0; start < chars.length; start += step) {
    lines.push(chars.slice(start, start + step).join(''));
  }
  return lines;
}

async function createDeploymentCredentials(
  ctx: ExtensionCommandContext,
  host: PrefactorCommandHost,
  apiUrl: string,
  grant: DeviceGrant,
  accountApi: PrefactorApi
): Promise<boolean> {
  if (!grant.account_id) {
    throw new Error('The sign-in did not return an account id.');
  }

  const agent = await chooseAgent(ctx, accountApi);
  if (!agent) {
    return false;
  }
  const environmentId = await chooseEnvironment(ctx, accountApi, agent.id, grant.account_id);
  if (!environmentId) {
    return false;
  }

  const token = await accountApi.createDeploymentToken(agent.id, environmentId);
  await checkDeploymentToken(host, apiUrl, token, agent.id);

  await writeCredentialsFile({
    api_url: apiUrl,
    api_token: token,
    agent_id: agent.id,
    agent_name: agent.name,
    environment_id: environmentId,
    account_id: grant.account_id,
    ...(grant.account_name ? { account_name: grant.account_name } : {}),
    created_at: new Date().toISOString(),
  });
  ctx.ui.notify(
    `Connected pi to the Prefactor agent "${agent.name}"${grant.account_name ? ` in ${grant.account_name}` : ''}.`,
    'info'
  );
  return true;
}

const CREATE_AGENT = 'Create a new agent for pi';
const USE_EXISTING_AGENT = 'Use an existing agent';

/**
 * Chooses the agent pi reports to: a new agent, named and described by the user, or an existing
 * one. Returns undefined when the user cancels at any step.
 */
async function chooseAgent(
  ctx: ExtensionCommandContext,
  api: PrefactorApi
): Promise<AgentSummary | undefined> {
  const agents = await api.listAgents();
  const choice = await ctx.ui.select(
    'Which Prefactor agent should pi report to?',
    agents.length > 0 ? [CREATE_AGENT, USE_EXISTING_AGENT] : [CREATE_AGENT]
  );
  if (choice === CREATE_AGENT) {
    return createNamedAgent(ctx, api, agents);
  }
  if (choice === USE_EXISTING_AGENT) {
    return chooseExistingAgent(ctx, agents);
  }
  return undefined;
}

async function createNamedAgent(
  ctx: ExtensionCommandContext,
  api: PrefactorApi,
  agents: AgentSummary[]
): Promise<AgentSummary | undefined> {
  // pi's terminal UI does not show input placeholders, so the titles also name the defaults.
  const name = await ctx.ui.input(
    `Name for the new agent (default: ${DEFAULT_AGENT_NAME})`,
    DEFAULT_AGENT_NAME
  );
  if (name === undefined) {
    return undefined;
  }
  const agentName = name.trim() || DEFAULT_AGENT_NAME;
  const existing = agents.find((agent) => agent.name === agentName);
  if (existing) {
    const useExisting = await ctx.ui.confirm(
      `An agent named "${agentName}" already exists`,
      'Use the existing agent instead?'
    );
    return useExisting ? existing : undefined;
  }

  const description = await ctx.ui.input(
    `Description (optional, default: ${DEFAULT_AGENT_DESCRIPTION})`,
    DEFAULT_AGENT_DESCRIPTION
  );
  if (description === undefined) {
    return undefined;
  }
  return api.createAgent(agentName, description.trim() || DEFAULT_AGENT_DESCRIPTION);
}

/**
 * Lets the user pick one of the account's agents: a type-to-filter list in pi's terminal UI, or a
 * plain list where custom UI is not available, such as RPC mode.
 */
async function chooseExistingAgent(
  ctx: ExtensionCommandContext,
  agents: AgentSummary[]
): Promise<AgentSummary | undefined> {
  const labels = agents.map((agent) =>
    agents.filter((other) => other.name === agent.name).length > 1
      ? `${agent.name} (${agent.id})`
      : agent.name
  );
  const title = 'Choose the agent pi reports to';
  const choice =
    ctx.mode === 'tui'
      ? await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
          const filter = new Input({ placeholder: 'Type to filter' });
          filter.focused = true;
          const list = new SelectList(
            labels.map((label) => ({ value: label, label })),
            Math.min(labels.length, 10),
            {
              selectedPrefix: (text) => theme.fg('accent', text),
              selectedText: (text) => theme.fg('accent', text),
              description: (text) => theme.fg('muted', text),
              scrollInfo: (text) => theme.fg('dim', text),
              // SelectList's own empty-filter text speaks of commands.
              noMatch: () => theme.fg('warning', '  No matching agents'),
            }
          );
          list.onSelect = (item) => done(item.value);
          list.onCancel = () => done(undefined);
          const container = new Container();
          container.addChild(new Text(theme.fg('accent', title)));
          container.addChild(filter);
          container.addChild(list);
          container.addChild(
            new Text(theme.fg('dim', 'type to filter · ↑↓ navigate · enter select · esc cancel'))
          );
          const listKeys = [
            'tui.select.up',
            'tui.select.down',
            'tui.select.pageUp',
            'tui.select.pageDown',
            'tui.select.confirm',
            'tui.select.cancel',
          ] as const;
          return {
            render: (width: number) => container.render(width),
            invalidate: () => container.invalidate(),
            handleInput(data: string) {
              if (listKeys.some((key) => keybindings.matches(data, key))) {
                list.handleInput(data);
              } else {
                filter.handleInput(data);
                list.setFilter(filter.getValue());
              }
              tui.requestRender();
            },
          };
        })
      : await ctx.ui.select(title, labels);
  return choice === undefined ? undefined : agents[labels.indexOf(choice)];
}

/**
 * Chooses the environment as `prefactor setup` does: the environment of the agent's only
 * deployment, or of its only deployment with a current version. Otherwise the user chooses.
 */
async function chooseEnvironment(
  ctx: ExtensionCommandContext,
  api: PrefactorApi,
  agentId: string,
  accountId: string
): Promise<string | undefined> {
  const deployments = await api.listDeployments(agentId);
  if (deployments.length === 1) {
    return deployments[0].environment_id;
  }
  const current = deployments.filter((deployment) => deployment.current_version_id !== null);
  if (current.length === 1) {
    return current[0].environment_id;
  }

  const environments = await api.listEnvironments(accountId);
  const candidates =
    deployments.length > 0
      ? environments.filter((environment) =>
          deployments.some((deployment) => deployment.environment_id === environment.id)
        )
      : environments;
  if (candidates.length === 0) {
    throw new Error('The account has no environments. Create one in Prefactor first.');
  }
  if (candidates.length === 1) {
    return candidates[0].id;
  }

  const labels = candidates.map((environment) => `${environment.name} (${environment.id})`);
  const choice = await ctx.ui.select('Which environment should pi report to?', labels);
  return choice === undefined ? undefined : candidates[labels.indexOf(choice)].id;
}

async function checkDeploymentToken(
  host: PrefactorCommandHost,
  apiUrl: string,
  token: string,
  agentId: string
): Promise<void> {
  const details = await new PrefactorApi(host.createClient(apiUrl, token)).ping();
  if (details.token_type !== DEPLOYMENT_TOKEN_TYPE || details.agent_id !== agentId) {
    throw new Error('The new deployment token did not pass its check.');
  }
}

/**
 * Revokes the account token from the sign-in with the token itself, so it is never left valid.
 */
async function revokeAccountToken(ctx: ExtensionCommandContext, api: PrefactorApi): Promise<void> {
  try {
    const { api_token_id: tokenId } = await api.ping();
    if (!tokenId) {
      throw new Error('ping returned no api_token_id');
    }
    await api.revokeToken(tokenId);
  } catch (error) {
    ctx.ui.notify(
      `Could not revoke the sign-in token (${describe(error)}). Revoke it under Account settings in Prefactor.`,
      'warning'
    );
  }
}

async function setupWithPastedToken(
  ctx: ExtensionCommandContext,
  host: PrefactorCommandHost,
  apiUrl: string
): Promise<boolean> {
  ctx.ui.notify('The token you paste is visible on screen.', 'warning');
  const token = (await ctx.ui.input('Paste an agent-deployment token'))?.trim();
  if (!token) {
    return false;
  }

  const details = await new PrefactorApi(host.createClient(apiUrl, token)).ping();
  if (details.token_type !== DEPLOYMENT_TOKEN_TYPE || !details.agent_id) {
    throw new Error('That is not an agent-deployment token.');
  }

  await writeCredentialsFile({
    api_url: apiUrl,
    api_token: token,
    agent_id: details.agent_id,
    ...(details.environment_id ? { environment_id: details.environment_id } : {}),
    // A deployment token cannot read its agent's or account's name, so only ids are saved.
    ...(details.account_id ? { account_id: details.account_id } : {}),
    created_at: new Date().toISOString(),
  });
  ctx.ui.notify(`Connected pi to the Prefactor agent ${details.agent_id}.`, 'info');
  return true;
}

async function status(ctx: ExtensionCommandContext, host: PrefactorCommandHost): Promise<void> {
  const recording = host.getRecording();
  const credentials = await host.resolveCredentials();
  const file: CredentialsFile | undefined =
    credentials?.source === 'file' ? await readCredentialsFile() : undefined;

  const lines = recording
    ? [
        `This session records to ${recording.credentials.apiUrl}, agent ${recording.credentials.agentId ?? '(read from the token)'}, with credentials from the ${SOURCE_LABELS[recording.credentials.source]}.`,
        recording.lastError
          ? `Last request to Prefactor failed: ${describe(recording.lastError)}`
          : 'Last request to Prefactor succeeded.',
      ]
    : ['This session is not being recorded.'];

  if (credentials) {
    lines.push(
      `New sessions use credentials from the ${SOURCE_LABELS[credentials.source]}${credentials.source === 'file' ? ` (${getCredentialsFilePath()})` : ''}:`,
      `  API URL: ${credentials.apiUrl}`,
      ...(file?.account_name || file?.account_id
        ? [`  Account: ${file.account_name ?? file.account_id}`]
        : []),
      `  Agent: ${file?.agent_name ?? credentials.agentId ?? '(read from the token)'}`
    );
  } else {
    lines.push('Prefactor is not set up. Run /prefactor setup to connect pi to Prefactor.');
  }
  ctx.ui.notify(lines.join('\n'), 'info');
}

async function logout(ctx: ExtensionCommandContext, host: PrefactorCommandHost): Promise<void> {
  const deleted = await deleteCredentialsFile();
  const remaining = await host.resolveCredentials();
  const message = [
    deleted
      ? `Deleted ${getCredentialsFilePath()}.`
      : `There is no credentials file at ${getCredentialsFilePath()}.`,
    ...(remaining
      ? [`Credentials from the ${SOURCE_LABELS[remaining.source]} are unaffected.`]
      : []),
    ...(host.getRecording() ? ['This session keeps recording until it ends.'] : []),
  ];
  ctx.ui.notify(message.join(' '), 'info');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
