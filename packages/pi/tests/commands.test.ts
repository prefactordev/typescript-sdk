import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PrefactorCommandHost, registerPrefactorCommand } from '../src/commands.js';
import { resolveCredentials } from '../src/credentials.js';
import { prefactorExtension } from '../src/extension.js';
import { createHttpClient } from '../src/prefactor-session.js';
import {
  createContext,
  createPi,
  isolateEnvironment,
  renderWidget,
  visibleText,
} from './helpers.js';

const API_URL = 'https://prefactor.example';
const ACCOUNT_TOKEN = 'account-token';
const DEPLOYMENT_TOKEN = 'deployment-token';
const DEPLOYMENT_TOKEN_TYPE = 'api_session_agent_deployment_scope';

type Request = { method: string; path: string; auth: string | null; body: unknown };
type Reply = { status?: number; body: unknown };
type Route = (request: Request) => Reply | Promise<Reply> | undefined;

/** Never settles: stands in for the "waiting for approval" dialog the user leaves open. */
const leaveOpen = () => new Promise(() => undefined);

const CREATE_AGENT = 'Create a new agent for pi';
const USE_EXISTING_AGENT = 'Use an existing agent';
const OTHER_AND_PI = [
  { id: 'agent-other', name: 'other' },
  { id: 'agent-pi', name: 'pi' },
];

describe('/prefactor', () => {
  let dir: string;
  let restoreEnvironment: () => void;
  let requests: Request[];
  let routes: Route[];
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    ({ dir, restore: restoreEnvironment } = isolateEnvironment());
    requests = [];
    routes = [];
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = new URL(String(input));
      const request: Request = {
        method: init?.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        auth: new Headers(init?.headers).get('authorization'),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      requests.push(request);
      const reply = await routes
        .map((route) => route(request))
        .find((result) => result !== undefined);
      if (!reply) {
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    restoreEnvironment();
  });

  const credentialsPath = () => join(dir, 'prefactor.json');
  const readSaved = () =>
    JSON.parse(readFileSync(credentialsPath(), 'utf8')) as Record<string, unknown>;
  const paths = () => requests.map((request) => `${request.method} ${request.path.split('?')[0]}`);

  function host(overrides: Partial<PrefactorCommandHost> = {}): PrefactorCommandHost {
    return {
      resolveCredentials: () => resolveCredentials({}),
      getRecording: () => null,
      startRecording: async () => undefined,
      createClient: (apiUrl, apiToken) => createHttpClient(apiUrl, apiToken, 'test'),
      clientVersion: '@prefactor/pi@test',
      loginDeps: { sleep: async () => undefined },
      openBrowser: () => undefined,
      ...overrides,
    };
  }

  async function run(args: string, ctx: ReturnType<typeof createContext>, commandHost = host()) {
    const { pi, runCommand } = createPi();
    registerPrefactorCommand(pi as never, commandHost);
    await runCommand('prefactor', args, ctx);
  }

  function serveBrowserSignIn(options: { agents?: unknown[]; revokeStatus?: number } = {}) {
    process.env.PREFACTOR_API_URL = API_URL;
    let polls = 0;
    routes.push((request) => {
      const key = `${request.method} ${request.path.split('?')[0]}`;
      const asAccount = request.auth === `Bearer ${ACCOUNT_TOKEN}`;
      switch (key) {
        case 'POST /cli/login/start':
          return {
            body: {
              login_token: 'login',
              device_code: 'device',
              user_code: 'ABCD-1234',
              verification_uri_complete: `${API_URL}/cli/connect?code=ABCD-1234`,
              verification_qr_code: '██ QR ██',
              expires_in: 600,
              interval: 1,
            },
          };
        case 'POST /cli/login/token':
          polls += 1;
          return polls === 1
            ? { status: 400, body: { error: 'authorization_pending' } }
            : {
                body: {
                  access_token: ACCOUNT_TOKEN,
                  account_id: 'account-1',
                  account_name: 'Acme',
                },
              };
        case 'GET /api/v1/agent':
          return asAccount
            ? { body: { summaries: options.agents ?? [], pagination: null } }
            : undefined;
        case 'POST /api/v1/agent': {
          const { name } = (request.body as { details: { name: string } }).details;
          return asAccount ? { body: { details: { id: 'agent-pi', name } } } : undefined;
        }
        case 'GET /api/v1/agent_deployment':
          return asAccount ? { body: { summaries: [] } } : undefined;
        case 'GET /api/v1/environment':
          return asAccount
            ? { body: { summaries: [{ id: 'env-dev', name: 'Development' }] } }
            : undefined;
        case 'POST /api/v1/api_token':
          return asAccount
            ? { body: { details: { id: 'deployment-token-id' }, token: DEPLOYMENT_TOKEN } }
            : undefined;
        case 'GET /api/v1/ping':
          return asAccount
            ? {
                body: {
                  details: {
                    token_type: 'api_session_account_scope',
                    api_token_id: 'account-token-id',
                  },
                },
              }
            : {
                body: {
                  details: {
                    token_type: DEPLOYMENT_TOKEN_TYPE,
                    agent_id: 'agent-pi',
                    environment_id: 'env-dev',
                  },
                },
              };
        case 'POST /api/v1/api_token/account-token-id/revoke':
          return {
            status: options.revokeStatus ?? 200,
            body: { details: { id: 'account-token-id' } },
          };
        default:
          return undefined;
      }
    });
  }

  test('setup signs in through the browser, creates an agent named pi and saves a deployment token', async () => {
    serveBrowserSignIn({ agents: [{ id: 'agent-other', name: 'other' }] });
    let recordingStarted = false;
    const ctx = createContext({
      hasUI: true,
      answers: ['Sign in with your browser', leaveOpen, CREATE_AGENT, '', ''],
    });

    await run(
      'setup',
      ctx,
      host({
        startRecording: async () => {
          recordingStarted = true;
        },
      })
    );

    expect(readSaved()).toMatchObject({
      api_url: API_URL,
      api_token: DEPLOYMENT_TOKEN,
      agent_id: 'agent-pi',
      agent_name: 'pi',
      environment_id: 'env-dev',
      account_id: 'account-1',
      account_name: 'Acme',
    });
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(readSaved())).not.toContain(ACCOUNT_TOKEN);
    expect(ctx.dialogs.slice(2)).toEqual([
      {
        kind: 'select',
        title: 'Which Prefactor agent should pi report to?',
        choices: [CREATE_AGENT, USE_EXISTING_AGENT],
      },
      { kind: 'input', title: 'Name for the new agent (default: pi)', placeholder: 'pi' },
      {
        kind: 'input',
        title: 'Description (optional, default: pi coding agent sessions)',
        placeholder: 'pi coding agent sessions',
      },
    ]);
    expect(
      requests.find((request) => request.path === '/api/v1/agent' && request.method === 'POST')
        ?.body
    ).toEqual({
      details: { name: 'pi', description: 'pi coding agent sessions' },
    });
    expect(renderWidget(ctx.widgets[0], 80).map(visibleText)).toEqual([
      `${API_URL}/cli/connect?code=ABCD-1234`,
    ]);
    expect(ctx.widgets.at(-1)).toBeUndefined();
    expect(requests.find((request) => request.path === '/api/v1/api_token')?.body).toEqual({
      details: { token_scope: 'agent_deployment', agent_id: 'agent-pi', environment_id: 'env-dev' },
    });
    const revoke = requests.find((request) => request.path.endsWith('/revoke'));
    expect(revoke?.auth).toBe(`Bearer ${ACCOUNT_TOKEN}`);
    expect(paths().indexOf('POST /api/v1/api_token/account-token-id/revoke')).toBe(
      requests.length - 1
    );
    expect(recordingStarted).toBe(true);
  });

  test('setup keeps the deployment token and says where to revoke the account token when revoking fails', async () => {
    serveBrowserSignIn({ agents: [{ id: 'agent-pi', name: 'pi' }], revokeStatus: 403 });
    const ctx = createContext({
      hasUI: true,
      mode: 'rpc',
      answers: ['Sign in with your browser', leaveOpen, USE_EXISTING_AGENT, 'pi'],
    });

    await run('setup', ctx);

    expect(readSaved().api_token).toBe(DEPLOYMENT_TOKEN);
    expect(ctx.notifications.at(-1)).toContain('Revoke it under Account settings');
  });

  test('setup sends the sign-in link to RPC clients as a plain widget line', async () => {
    serveBrowserSignIn({ agents: [{ id: 'agent-pi', name: 'pi' }] });
    const ctx = createContext({
      hasUI: true,
      mode: 'rpc',
      answers: ['Sign in with your browser', leaveOpen, USE_EXISTING_AGENT, 'pi'],
    });

    await run('setup', ctx);

    expect(ctx.widgets[0]).toEqual([`${API_URL}/cli/connect?code=ABCD-1234`]);
    expect(ctx.widgets.at(-1)).toBeUndefined();
  });

  test('setup saves nothing but still revokes the account token when the user cancels the agent choice', async () => {
    serveBrowserSignIn();
    const ctx = createContext({
      hasUI: true,
      answers: ['Sign in with your browser', leaveOpen, undefined],
    });

    await run('setup', ctx);

    expect(existsSync(credentialsPath())).toBe(false);
    expect(paths()).toContain('POST /api/v1/api_token/account-token-id/revoke');
    expect(paths()).not.toContain('POST /api/v1/api_token');
  });

  async function cancelledBrowserSignIn(): Promise<ReturnType<typeof createContext>> {
    serveBrowserSignIn();
    const ctx = createContext({
      hasUI: true,
      answers: ['Sign in with your browser', 'Cancel sign-in'],
    });
    await run('setup', ctx);
    return ctx;
  }

  test('setup stops polling when the user cancels the sign-in', async () => {
    const ctx = await cancelledBrowserSignIn();

    expect(existsSync(credentialsPath())).toBe(false);
    expect(ctx.notifications.at(-1)).toBe('Prefactor setup cancelled. Nothing was saved.');
    expect(paths()).not.toContain('GET /api/v1/agent');
  });

  test('setup offers browser sign-in first and shows the code once, in the dialog, with a clickable link', async () => {
    const ctx = await cancelledBrowserSignIn();
    const url = `${API_URL}/cli/connect?code=ABCD-1234`;

    const lines = renderWidget(ctx.widgets[0], 200);

    expect(ctx.dialogs.slice(0, 2)).toEqual([
      {
        kind: 'select',
        title: 'Connect pi to Prefactor',
        choices: ['Sign in with your browser', 'Paste an agent-deployment token'],
      },
      {
        kind: 'select',
        title: 'Approve code ABCD-1234 in your browser',
        choices: ['Cancel sign-in'],
      },
    ]);
    expect(lines.map(visibleText)).toEqual([url]);
    expect(lines[0]).toContain(`\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`);
    expect(lines.join('')).not.toContain('QR');
  });

  test('setup breaks the link at the terminal width, each line its own hyperlink to the full link', async () => {
    const ctx = await cancelledBrowserSignIn();
    const url = `${API_URL}/cli/connect?code=ABCD-1234`;

    const lines = renderWidget(ctx.widgets[0], 10);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map(visibleText).join('')).toBe(url);
    for (const line of lines) {
      expect([...visibleText(line)].length).toBeLessThanOrEqual(10);
      expect(line).toContain(`\x1b]8;;${url}\x1b\\${visibleText(line)}\x1b]8;;\x1b\\`);
    }
  });

  test('setup creates an agent with the name and description the user enters', async () => {
    serveBrowserSignIn();
    const ctx = createContext({
      hasUI: true,
      answers: ['Sign in with your browser', leaveOpen, CREATE_AGENT, ' my-agent ', ' My agent '],
    });

    await run('setup', ctx);

    expect(ctx.dialogs[2].choices).toEqual([CREATE_AGENT]);
    expect(
      requests.find((request) => request.path === '/api/v1/agent' && request.method === 'POST')
        ?.body
    ).toEqual({
      details: { name: 'my-agent', description: 'My agent' },
    });
    expect(readSaved()).toMatchObject({ agent_id: 'agent-pi', agent_name: 'my-agent' });
  });

  test('setup uses the existing agent when the new name is taken and the user agrees', async () => {
    serveBrowserSignIn({ agents: OTHER_AND_PI });
    const ctx = createContext({
      hasUI: true,
      answers: ['Sign in with your browser', leaveOpen, CREATE_AGENT, 'pi', true],
    });

    await run('setup', ctx);

    expect(ctx.dialogs.at(-1)).toEqual({
      kind: 'confirm',
      title: 'An agent named "pi" already exists',
    });
    expect(paths()).not.toContain('POST /api/v1/agent');
    expect(readSaved()).toMatchObject({ agent_id: 'agent-pi', agent_name: 'pi' });
  });

  test('setup lists existing agents in a plain list where custom UI is not available', async () => {
    serveBrowserSignIn({ agents: OTHER_AND_PI });
    const ctx = createContext({
      hasUI: true,
      mode: 'rpc',
      answers: ['Sign in with your browser', leaveOpen, USE_EXISTING_AGENT, 'pi'],
    });

    await run('setup', ctx);

    expect(ctx.dialogs.at(-1)).toEqual({
      kind: 'select',
      title: 'Choose the agent pi reports to',
      choices: ['other', 'pi'],
    });
    expect(readSaved()).toMatchObject({ agent_id: 'agent-pi', agent_name: 'pi' });
  });

  test('setup filters existing agents as the user types in the terminal UI', async () => {
    serveBrowserSignIn({ agents: OTHER_AND_PI });
    const ctx = createContext({
      hasUI: true,
      answers: ['Sign in with your browser', leaveOpen, USE_EXISTING_AGENT],
      customKeys: ['p', '\r'],
    });

    await run('setup', ctx);

    const afterTyping = ctx.customRenders[1].map(visibleText).join('\n');
    expect(afterTyping).toContain('pi');
    expect(afterTyping).not.toContain('other');
    expect(readSaved()).toMatchObject({ agent_id: 'agent-pi', agent_name: 'pi' });
  });

  test('setup says no agents match when the filter matches none', async () => {
    serveBrowserSignIn({ agents: OTHER_AND_PI });
    const ctx = createContext({
      hasUI: true,
      answers: ['Sign in with your browser', leaveOpen, USE_EXISTING_AGENT],
      customKeys: ['x', '\x1b'],
    });

    await run('setup', ctx);

    expect(ctx.customRenders[1].map(visibleText)).toContain('  No matching agents');
  });

  const cancelledAgentSteps: Array<{
    step: string;
    mode?: 'tui' | 'rpc';
    answers: unknown[];
    customKeys?: string[];
  }> = [
    { step: 'the agent name', answers: [CREATE_AGENT, undefined] },
    { step: 'the agent description', answers: [CREATE_AGENT, 'new-agent', undefined] },
    { step: 'using the existing agent with that name', answers: [CREATE_AGENT, 'pi', false] },
    { step: 'the plain agent list', mode: 'rpc', answers: [USE_EXISTING_AGENT, undefined] },
    { step: 'the agent filter list', answers: [USE_EXISTING_AGENT], customKeys: ['\x1b'] },
  ];
  for (const { step, mode, answers, customKeys } of cancelledAgentSteps) {
    test(`setup saves nothing and revokes the account token when the user cancels ${step}`, async () => {
      serveBrowserSignIn({ agents: OTHER_AND_PI });
      const ctx = createContext({
        hasUI: true,
        mode,
        answers: ['Sign in with your browser', leaveOpen, ...answers],
        customKeys,
      });

      await run('setup', ctx);

      expect(existsSync(credentialsPath())).toBe(false);
      expect(paths()).not.toContain('POST /api/v1/agent');
      expect(paths()).toContain('POST /api/v1/api_token/account-token-id/revoke');
    });
  }

  test('setup asks for a pasted token when the server does not offer browser sign-in', async () => {
    process.env.PREFACTOR_API_URL = API_URL;
    routes.push((request) =>
      request.path === '/api/v1/ping'
        ? {
            body: {
              details: {
                token_type: DEPLOYMENT_TOKEN_TYPE,
                account_id: 'account-1',
                agent_id: 'agent-7',
                environment_id: 'env-1',
              },
            },
          }
        : undefined
    );
    const ctx = createContext({
      hasUI: true,
      answers: ['Sign in with your browser', ` ${DEPLOYMENT_TOKEN} `],
    });

    await run('setup', ctx);

    expect(readSaved()).toMatchObject({
      api_url: API_URL,
      api_token: DEPLOYMENT_TOKEN,
      agent_id: 'agent-7',
      environment_id: 'env-1',
      account_id: 'account-1',
    });
    expect(readSaved()).not.toHaveProperty('agent_name');
    expect(readSaved()).not.toHaveProperty('account_name');
    expect(ctx.notifications).toContain('The token you paste is visible on screen.');
  });

  test('setup asks before replacing existing credentials', async () => {
    writeFileSync(credentialsPath(), JSON.stringify({ api_token: 'old' }));
    const ctx = createContext({ hasUI: true, answers: [false] });

    await run('setup', ctx);

    expect(ctx.dialogs).toEqual([expect.objectContaining({ kind: 'confirm' })]);
    expect(readSaved().api_token).toBe('old');
  });

  test('status shows the credential source, account, agent and last request', async () => {
    writeFileSync(
      credentialsPath(),
      JSON.stringify({
        api_url: API_URL,
        api_token: 't',
        agent_id: 'a',
        agent_name: 'pi',
        account_name: 'Acme',
      })
    );
    const ctx = createContext({ hasUI: true });

    await run(
      'status',
      ctx,
      host({
        getRecording: () => ({
          credentials: { source: 'file', apiUrl: API_URL, apiToken: 't' },
          lastError: new Error('HTTP request failed with status 500'),
          startState: 'started',
        }),
      })
    );

    const message = ctx.notifications[0];
    expect(message).toContain(`credentials file (${credentialsPath()})`);
    expect(message).toContain(`API URL: ${API_URL}`);
    expect(message).toContain('Account: Acme');
    expect(message).toContain('Agent: pi');
    expect(message).toContain(
      'Last request to Prefactor failed: HTTP request failed with status 500'
    );
  });

  test('status shows the account and agent ids when the credentials file has no names', async () => {
    writeFileSync(
      credentialsPath(),
      JSON.stringify({
        api_url: API_URL,
        api_token: 't',
        agent_id: 'agent-7',
        account_id: 'account-1',
      })
    );
    const ctx = createContext({ hasUI: true });

    await run('status', ctx);

    expect(ctx.notifications[0]).toContain('Account: account-1');
    expect(ctx.notifications[0]).toContain('Agent: agent-7');
  });

  test('status shows the active recording separately when no credentials are saved', async () => {
    const ctx = createContext({ hasUI: true });

    await run(
      'status',
      ctx,
      host({
        getRecording: () => ({
          credentials: { source: 'file', apiUrl: API_URL, apiToken: 't', agentId: 'agent-a' },
          lastError: null,
          startState: 'started',
        }),
      })
    );

    expect(ctx.notifications[0].split('\n')).toEqual([
      `This session records to ${API_URL}, agent agent-a, with credentials from the credentials file.`,
      'Last request to Prefactor succeeded.',
      'Prefactor is not set up. Run /prefactor setup to connect pi to Prefactor.',
    ]);
  });

  test('logout deletes the credentials file and says environment credentials are unaffected', async () => {
    writeFileSync(credentialsPath(), JSON.stringify({ api_token: 't' }));
    process.env.PREFACTOR_API_TOKEN = 'env-token';
    const ctx = createContext({ hasUI: true });

    await run('logout', ctx);

    expect(existsSync(credentialsPath())).toBe(false);
    expect(ctx.notifications[0]).toContain(
      'Credentials from the PREFACTOR_* environment variables are unaffected.'
    );
  });

  test('setup replaces a recording whose agent instance failed to start', async () => {
    process.env.PREFACTOR_API_URL = API_URL;
    writeFileSync(
      credentialsPath(),
      JSON.stringify({ api_url: API_URL, api_token: 'expired', agent_id: 'agent-7' })
    );
    let nextId = 0;
    routes.push((request) => {
      if (request.auth === 'Bearer expired') {
        return { status: 401, body: { code: 'bad_authtoken' } };
      }
      if (request.path === '/api/v1/ping') {
        return { body: { details: { token_type: DEPLOYMENT_TOKEN_TYPE, agent_id: 'agent-7' } } };
      }
      nextId += 1;
      return { body: { details: { id: `id-${nextId}` } } };
    });
    const { pi, emit, runCommand } = createPi();
    prefactorExtension()(pi as never);
    const ctx = createContext({
      hasUI: true,
      answers: [true, 'Paste an agent-deployment token', DEPLOYMENT_TOKEN],
    });

    await emit({ type: 'session_start', reason: 'startup' }, ctx);
    for (let attempt = 0; attempt < 50 && requests.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    await runCommand('prefactor', 'status', ctx);
    expect(ctx.notifications.at(-1)).toContain('Last request to Prefactor failed');

    await runCommand('prefactor', 'setup', ctx);
    await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);

    const withNewToken = requests.filter(
      (request) => request.auth === `Bearer ${DEPLOYMENT_TOKEN}`
    );
    expect(withNewToken.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /api/v1/ping',
      'POST /api/v1/agent_instance/register',
      'POST /api/v1/agent_instance/id-1/start',
      'POST /api/v1/agent_spans',
      'POST /api/v1/agent_spans/id-3/finish',
      'POST /api/v1/agent_instance/id-1/finish',
    ]);
    expect(withNewToken[3].body).toMatchObject({ details: { payload: { reason: 'setup' } } });
  });

  test('setup says the current session keeps recording with its own credentials', async () => {
    process.env.PREFACTOR_API_URL = API_URL;
    routes.push((request) =>
      request.path === '/api/v1/ping'
        ? { body: { details: { token_type: DEPLOYMENT_TOKEN_TYPE, agent_id: 'agent-b' } } }
        : undefined
    );
    const ctx = createContext({
      hasUI: true,
      answers: ['Paste an agent-deployment token', DEPLOYMENT_TOKEN],
    });

    await run(
      'setup',
      ctx,
      host({
        getRecording: () => ({
          credentials: {
            source: 'environment',
            apiUrl: API_URL,
            apiToken: 'old',
            agentId: 'agent-a',
          },
          lastError: null,
          startState: 'started',
        }),
      })
    );

    expect(ctx.notifications.at(-1)).toBe(
      `This session keeps recording to ${API_URL}, agent agent-a. New sessions use the new credentials.`
    );
  });

  test('setup switches the session to the saved credentials when the pending recording later fails to start', async () => {
    process.env.PREFACTOR_API_URL = API_URL;
    writeFileSync(
      credentialsPath(),
      JSON.stringify({ api_url: API_URL, api_token: 'expired', agent_id: 'agent-7' })
    );
    let rejectOldRegistration: (() => void) | undefined;
    const oldRegistration = new Promise<Reply>((resolve) => {
      rejectOldRegistration = () => resolve({ status: 401, body: { code: 'bad_authtoken' } });
    });
    let nextId = 0;
    routes.push((request) => {
      if (request.auth === 'Bearer expired') {
        return oldRegistration;
      }
      if (request.path === '/api/v1/ping') {
        return { body: { details: { token_type: DEPLOYMENT_TOKEN_TYPE, agent_id: 'agent-7' } } };
      }
      nextId += 1;
      return { body: { details: { id: `id-${nextId}` } } };
    });
    const { pi, emit, runCommand } = createPi();
    prefactorExtension()(pi as never);
    const ctx = createContext({
      hasUI: true,
      answers: [true, 'Paste an agent-deployment token', DEPLOYMENT_TOKEN],
    });

    await emit({ type: 'session_start', reason: 'startup' }, ctx);
    await runCommand('prefactor', 'setup', ctx);
    expect(ctx.notifications.at(-1)).toContain('switches to the new credentials only if');
    expect(requests.filter((request) => request.path.endsWith('/register'))).toHaveLength(1);

    rejectOldRegistration?.();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (
        requests.some(
          (r) => r.auth === `Bearer ${DEPLOYMENT_TOKEN}` && r.path.endsWith('/register')
        )
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);

    const withNewToken = requests.filter(
      (request) => request.auth === `Bearer ${DEPLOYMENT_TOKEN}`
    );
    expect(withNewToken.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /api/v1/ping',
      'POST /api/v1/agent_instance/register',
      'POST /api/v1/agent_instance/id-1/start',
      'POST /api/v1/agent_spans',
      'POST /api/v1/agent_spans/id-3/finish',
      'POST /api/v1/agent_instance/id-1/finish',
    ]);
    expect(withNewToken[3].body).toMatchObject({ details: { payload: { reason: 'setup' } } });
  });

  test('a pasted token during an unrecorded session starts recording it', async () => {
    process.env.PREFACTOR_API_URL = API_URL;
    let nextId = 0;
    routes.push((request) => {
      if (request.path === '/api/v1/ping') {
        return { body: { details: { token_type: DEPLOYMENT_TOKEN_TYPE, agent_id: 'agent-7' } } };
      }
      nextId += 1;
      return { body: { details: { id: `id-${nextId}` } } };
    });
    const { pi, emit, runCommand } = createPi();
    prefactorExtension()(pi as never);
    const ctx = createContext({
      hasUI: true,
      answers: ['Paste an agent-deployment token', DEPLOYMENT_TOKEN],
    });

    await emit({ type: 'session_start', reason: 'startup' }, ctx);
    await runCommand('prefactor', 'setup', ctx);
    await emit({ type: 'session_shutdown', reason: 'quit' }, ctx);

    expect(paths()).toEqual([
      'GET /api/v1/ping',
      'POST /api/v1/agent_instance/register',
      'POST /api/v1/agent_instance/id-1/start',
      'POST /api/v1/agent_spans',
      'POST /api/v1/agent_spans/id-3/finish',
      'POST /api/v1/agent_instance/id-1/finish',
    ]);
    expect(requests[1].body).toMatchObject({ agent_id: 'agent-7' });
    expect(requests[3].body).toMatchObject({ details: { payload: { reason: 'setup' } } });
  });
});
