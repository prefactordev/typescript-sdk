import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { DEFAULT_BASE_URL, DEFAULT_PROFILE_NAME, ProfileManager } from '../profile-manager.js';
import { clientHostname, clientPlatform } from './client-info.js';

const SLOW_DOWN_EXTRA_MS = 5_000;
// The server rejects longer client details with invalid_request.
const MAX_CLIENT_INFO_LENGTH = 64;

function stripTrailingSlashes(baseUrl: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === '/') {
    end--;
  }
  return end === baseUrl.length ? baseUrl : baseUrl.slice(0, end);
}

export function buildLoginUrl(baseUrl: string): string {
  return `${stripTrailingSlashes(baseUrl)}/cli/connect`;
}

export function browserOpenCommand(
  platform: NodeJS.Platform,
  url: string
): { command: string; args: string[] } | undefined {
  if (!isBrowserUrl(url)) {
    return undefined;
  }

  if (platform === 'darwin') {
    return { command: 'open', args: [url] };
  }

  // rundll32 takes the URL as an argument. cmd.exe would interpret it as a shell command.
  if (platform === 'win32') {
    return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  }

  return { command: 'xdg-open', args: [url] };
}

function isBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function openBrowserImpl(url: string): void {
  const open = browserOpenCommand(process.platform, url);
  if (!open) {
    return;
  }

  const child = spawn(open.command, open.args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {}); // fire-and-forget; ignore spawn errors
  child.unref();
}

async function promptForTokenImpl(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  const isTTY = process.stdin.isTTY;
  if (isTTY) {
    process.stdin.setRawMode(true);
  }

  return new Promise((resolve) => {
    let input = '';

    function onData(chunk: Buffer) {
      const str = chunk.toString('utf8');
      for (const char of str) {
        const code = char.charCodeAt(0);
        if (char === '\r' || char === '\n') {
          cleanup('\n');
          resolve(input.trim());
          return;
        }
        if (code === 3) {
          // Ctrl+C
          cleanup('\n');
          process.exit(1);
        }
        if (code === 127 || code === 8) {
          // Backspace
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      }
    }

    function cleanup(suffix: string) {
      if (isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      process.stdout.write(suffix);
    }

    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

export function validateToken(token: string): void {
  if (token.trim().length === 0) {
    throw new Error('No API token provided. Please paste a valid token.');
  }
}

export interface LoginClientInfo {
  client_version?: string;
  platform?: string;
  hostname?: string;
}

export interface LoginDeps {
  openBrowser: (url: string) => void;
  promptForToken: (prompt: string) => Promise<string>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  clientInfo?: LoginClientInfo;
  terminalColumns?: () => number | undefined;
}

const defaultDeps: LoginDeps = {
  openBrowser: openBrowserImpl,
  promptForToken: promptForTokenImpl,
};

interface DeviceLoginStart {
  login_token: string;
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  verification_qr_code: string;
  expires_in: number;
  interval: number;
}

interface DeviceLoginGrant {
  access_token: string;
  account_name?: string;
}

export function registerLoginCommand(
  program: Command,
  deps: LoginDeps = defaultDeps,
  version: string
): void {
  program
    .command('login')
    .description('Authenticate the CLI with your Prefactor account')
    .action(async () => {
      const manager = await ProfileManager.create();
      const existing = manager.getProfile(DEFAULT_PROFILE_NAME);
      const baseUrl = existing?.base_url ?? DEFAULT_BASE_URL;
      const started = await startDeviceLogin(baseUrl, deps, version);

      if (started === 'unsupported') {
        await loginByPastingToken(manager, baseUrl, deps);
        return;
      }

      await loginWithDeviceCode(manager, baseUrl, started, deps);
    });
}

async function loginByPastingToken(
  manager: ProfileManager,
  baseUrl: string,
  deps: LoginDeps
): Promise<void> {
  const loginUrl = buildLoginUrl(baseUrl);

  console.log(`Opening your browser to: ${loginUrl}`);
  console.log('If the browser does not open automatically, visit the URL above.');
  deps.openBrowser(loginUrl);
  console.log('');
  console.log('After authenticating, copy your API token from the browser.');

  const token = await deps.promptForToken('Paste your API token here: ');
  validateToken(token);

  await manager.addProfile(DEFAULT_PROFILE_NAME, token, baseUrl);
  console.log(
    `Authentication successful. Credentials saved to the '${DEFAULT_PROFILE_NAME}' profile.`
  );
}

function terminalColumnsImpl(): number | undefined {
  return process.stdout.isTTY ? process.stdout.columns : undefined;
}

// A wrapped QR code cannot be scanned, so it is only printed when the terminal
// is known to be at least as wide as the code.
export function qrCodeFits(qrCode: string, columns: number | undefined): boolean {
  if (columns === undefined) {
    return false;
  }
  const width = Math.max(...qrCode.split('\n').map((line) => [...line].length));
  return width <= columns;
}

async function loginWithDeviceCode(
  manager: ProfileManager,
  baseUrl: string,
  started: DeviceLoginStart,
  deps: LoginDeps
): Promise<void> {
  const columns = (deps.terminalColumns ?? terminalColumnsImpl)();
  const showQrCode = qrCodeFits(started.verification_qr_code, columns);
  if (showQrCode) {
    console.log(started.verification_qr_code);
    console.log('');
  }
  console.log(`Opening your browser to approve this login: ${started.verification_uri_complete}`);
  console.log(
    showQrCode
      ? 'If the browser does not open automatically, visit the URL above or scan the QR code on another device.'
      : 'If the browser does not open automatically, visit the URL above.'
  );
  deps.openBrowser(started.verification_uri_complete);
  console.log('');
  console.log(`Confirm this code in the browser: ${started.user_code}`);
  console.log('Waiting for approval.');

  const grant = await pollForDeviceGrant(baseUrl, started, deps);
  await manager.addProfile(DEFAULT_PROFILE_NAME, grant.access_token, baseUrl);

  if (grant.account_name) {
    console.log(
      `Authentication successful. Signed in to ${grant.account_name}. Credentials saved to the '${DEFAULT_PROFILE_NAME}' profile.`
    );
    return;
  }

  console.log(
    `Authentication successful. Credentials saved to the '${DEFAULT_PROFILE_NAME}' profile.`
  );
}

async function startDeviceLogin(
  baseUrl: string,
  deps: LoginDeps,
  version: string
): Promise<DeviceLoginStart | 'unsupported'> {
  const origin = stripTrailingSlashes(baseUrl);
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const clientInfo = resolveClientInfo(deps, version);
  let response: Response;

  try {
    response = await fetchImpl(`${origin}/cli/login/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(clientInfo),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach ${origin} to start login. ${reason}`);
  }

  if (response.status === 404) {
    return 'unsupported';
  }

  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new Error(startFailureMessage(code, response.status));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Login start returned an unexpected response.');
  }

  if (!isDeviceLoginStart(body)) {
    throw new Error('Login start returned an unexpected response.');
  }

  return body;
}

async function pollForDeviceGrant(
  baseUrl: string,
  started: DeviceLoginStart,
  deps: LoginDeps
): Promise<DeviceLoginGrant> {
  const origin = stripTrailingSlashes(baseUrl);
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const deadline = now() + started.expires_in * 1000;
  let intervalMs = Math.max(1, started.interval) * 1000;
  // A rate-limited poll waits for retry-after instead of the interval, once.
  let waitMs = intervalMs;

  while (now() < deadline) {
    await sleep(waitMs);
    waitMs = intervalMs;
    if (now() >= deadline) {
      break;
    }

    let response: Response;
    try {
      response = await fetchImpl(`${origin}/cli/login/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          login_token: started.login_token,
          device_code: started.device_code,
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach ${origin} while waiting for approval. ${reason}`);
    }

    if (response.ok) {
      return await readDeviceGrant(response);
    }

    const code = await readErrorCode(response);
    if (response.status === 400 && code === 'authorization_pending') {
      continue;
    }

    if (response.status === 400 && code === 'slow_down') {
      intervalMs += SLOW_DOWN_EXTRA_MS;
      waitMs = intervalMs;
      continue;
    }

    if (response.status === 400 && code === 'access_denied') {
      throw new Error('The login was cancelled in the browser.');
    }

    if (response.status === 400 && code === 'expired_token') {
      throw new Error('Login expired or was already used. Run prefactor login again.');
    }

    if (response.status === 429 || code === 'rate_limited') {
      const current = now();
      waitMs = Math.min(
        retryAfterMs(response, intervalMs, current),
        Math.max(0, deadline - current)
      );
      continue;
    }

    throw new Error(tokenFailureMessage(code, response.status));
  }

  throw new Error('Login expired. Run prefactor login again.');
}

function resolveClientInfo(deps: LoginDeps, version: string): LoginClientInfo {
  const override = deps.clientInfo;
  const info: LoginClientInfo = {
    client_version: truncateClientInfo(override?.client_version ?? version),
  };
  const platform = override && 'platform' in override ? override.platform : clientPlatform();
  const host = override && 'hostname' in override ? override.hostname : clientHostname();

  if (platform) {
    info.platform = truncateClientInfo(platform);
  }
  if (host) {
    info.hostname = truncateClientInfo(host);
  }

  return info;
}

function truncateClientInfo(value: string): string {
  return value.slice(0, MAX_CLIENT_INFO_LENGTH);
}

function isDeviceLoginStart(value: unknown): value is DeviceLoginStart {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.login_token === 'string' &&
    value.login_token.length > 0 &&
    typeof value.device_code === 'string' &&
    value.device_code.length > 0 &&
    typeof value.user_code === 'string' &&
    value.user_code.length > 0 &&
    typeof value.verification_uri_complete === 'string' &&
    value.verification_uri_complete.length > 0 &&
    typeof value.verification_qr_code === 'string' &&
    typeof value.expires_in === 'number' &&
    Number.isFinite(value.expires_in) &&
    typeof value.interval === 'number' &&
    Number.isFinite(value.interval)
  );
}

async function readDeviceGrant(response: Response): Promise<DeviceLoginGrant> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Login approval returned an unexpected response.');
  }

  if (!isRecord(body) || typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new Error('Login approval returned an unexpected response.');
  }

  return {
    access_token: body.access_token,
    ...(typeof body.account_name === 'string' && body.account_name.length > 0
      ? { account_name: body.account_name }
      : {}),
  };
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as unknown;
    if (isRecord(body) && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function startFailureMessage(code: string | undefined, status: number): string {
  if (code === 'rate_limited' || status === 429) {
    return 'Login is rate limited. Wait and run prefactor login again.';
  }

  if (code) {
    return `Login could not start (${code}).`;
  }

  return `Login could not start (HTTP ${status}).`;
}

function tokenFailureMessage(code: string | undefined, status: number): string {
  if (code) {
    return `Login failed (${code}).`;
  }

  return `Login failed (HTTP ${status}).`;
}

// Retry-After is either a number of seconds or an HTTP date.
function retryAfterMs(response: Response, fallbackMs: number, nowMs: number): number {
  const header = response.headers.get('retry-after');
  if (!header) {
    return fallbackMs;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(fallbackMs, seconds * 1000);
  }

  const dateMs = Date.parse(header);
  if (Number.isNaN(dateMs)) {
    return fallbackMs;
  }

  return Math.max(fallbackMs, dateMs - nowMs);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
