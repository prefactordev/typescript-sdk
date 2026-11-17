import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
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
  getRecording(): { credentials: ResolvedCredentials; lastError: unknown } | null;
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
    'Sign in with the browser',
    'Paste an agent-deployment token',
  ]);
  if (method === undefined) {
    return;
  }

  const saved =
    method === 'Sign in with the browser'
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
 * Shows the code, link and QR code in pi and polls until the sign-in is approved. The user can
 * cancel from a dialog while pi waits.
 */
async function waitForApproval(
  ctx: ExtensionCommandContext,
  host: PrefactorCommandHost,
  apiUrl: string,
  login: DeviceLogin
): Promise<DeviceGrant> {
  ctx.ui.setWidget(LOGIN_WIDGET, [
    'Sign in to Prefactor to connect pi.',
    `Open ${login.verification_uri_complete}`,
    'or scan this QR code on another device:',
    ...login.verification_qr_code.split('\n'),
    `Check that the browser shows the code ${login.user_code}.`,
  ]);
  (host.openBrowser ?? openBrowser)(login.verification_uri_complete);

  const polling = new AbortController();
  const dialog = new AbortController();
  void ctx.ui
    .select(`Waiting for approval of code ${login.user_code}`, ['Cancel sign-in'], {
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

async function chooseAgent(
  ctx: ExtensionCommandContext,
  api: PrefactorApi
): Promise<AgentSummary | undefined> {
  const agents = await api.listAgents();
  const createLabel = `Create an agent named ${DEFAULT_AGENT_NAME}`;
  const labels = agents.map((agent) =>
    agents.filter((other) => other.name === agent.name).length > 1
      ? `${agent.name} (${agent.id})`
      : agent.name
  );
  const hasDefault = agents.some((agent) => agent.name === DEFAULT_AGENT_NAME);
  const options = hasDefault ? labels : [createLabel, ...labels];

  const choice = await ctx.ui.select('Which Prefactor agent should pi report to?', options);
  if (choice === undefined) {
    return undefined;
  }
  if (choice === createLabel) {
    return api.createAgent(DEFAULT_AGENT_NAME, DEFAULT_AGENT_DESCRIPTION);
  }
  return agents[labels.indexOf(choice)];
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
      ...(file?.account_name ? [`  Account: ${file.account_name}`] : []),
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
