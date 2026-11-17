import { spawn } from 'node:child_process';
import { hostname } from 'node:os';

const SLOW_DOWN_EXTRA_MS = 5_000;
// The server rejects longer client details with invalid_request.
const MAX_CLIENT_INFO_LENGTH = 64;

/**
 * A browser sign-in started with `POST /cli/login/start`.
 */
export interface DeviceLogin {
  login_token: string;
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/**
 * The account token returned once the user approves the sign-in.
 */
export interface DeviceGrant {
  access_token: string;
  account_id?: string;
  account_name?: string;
}

export interface DeviceLoginDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Thrown when the user cancels the sign-in from pi. */
export class LoginCancelledError extends Error {
  constructor() {
    super('Sign-in cancelled.');
    this.name = 'LoginCancelledError';
  }
}

/**
 * Starts a browser sign-in.
 *
 * @returns The sign-in details, or `'unsupported'` when the server does not offer browser sign-in.
 */
export async function startDeviceLogin(
  apiUrl: string,
  clientVersion: string,
  deps: DeviceLoginDeps = {}
): Promise<DeviceLogin | 'unsupported'> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const host = hostname().trim();
  const response = await fetchImpl(new URL('/cli/login/start', apiUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_version: clientVersion.slice(0, MAX_CLIENT_INFO_LENGTH),
      platform: `${process.platform}-${process.arch}`.slice(0, MAX_CLIENT_INFO_LENGTH),
      ...(host ? { hostname: host.slice(0, MAX_CLIENT_INFO_LENGTH) } : {}),
    }),
  });

  if (response.status === 404) {
    return 'unsupported';
  }
  if (!response.ok) {
    const code = await readErrorCode(response);
    throw new Error(`Sign-in could not start (${code ?? `HTTP ${response.status}`}).`);
  }

  const body = (await response.json()) as unknown;
  if (!isDeviceLogin(body)) {
    throw new Error('Sign-in start returned an unexpected response.');
  }
  return body;
}

/**
 * Polls until the user approves or denies the sign-in, or it expires.
 *
 * @throws {LoginCancelledError} When `signal` is aborted.
 */
export async function pollForDeviceGrant(
  apiUrl: string,
  login: DeviceLogin,
  signal: AbortSignal,
  deps: DeviceLoginDeps = {}
): Promise<DeviceGrant> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms: number) => abortableSleep(ms, signal));
  const now = deps.now ?? Date.now;
  const deadline = now() + login.expires_in * 1000;
  let intervalMs = Math.max(1, login.interval) * 1000;

  while (now() < deadline) {
    await sleep(intervalMs);
    if (signal.aborted) {
      throw new LoginCancelledError();
    }

    let response: Response;
    try {
      response = await fetchImpl(new URL('/cli/login/token', apiUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ login_token: login.login_token, device_code: login.device_code }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new LoginCancelledError();
      }
      throw error;
    }

    if (response.ok) {
      return readDeviceGrant(response);
    }

    const code = await readErrorCode(response);
    // slow_down is checked first because it can arrive with HTTP 429.
    if (code === 'slow_down') {
      intervalMs += SLOW_DOWN_EXTRA_MS;
      continue;
    }
    if (code === 'authorization_pending' || response.status === 429 || code === 'rate_limited') {
      continue;
    }
    if (code === 'access_denied') {
      throw new Error('The sign-in was denied in the browser.');
    }
    if (code === 'expired_token') {
      throw new Error('The sign-in expired. Run /prefactor setup again.');
    }
    throw new Error(`Sign-in failed (${code ?? `HTTP ${response.status}`}).`);
  }

  throw new Error('The sign-in expired. Run /prefactor setup again.');
}

/**
 * Opens a URL in the default browser. Failures are ignored, because the link is also shown in pi.
 */
export function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? // rundll32 takes the URL as an argument; cmd.exe would interpret it as a shell command.
          { file: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
        : { file: 'xdg-open', args: [url] };

  if (!/^https?:\/\//.test(url)) {
    return;
  }
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' });
  // Opening the browser is best effort: over SSH or in a container there may be no browser.
  child.on('error', () => undefined);
  child.unref();
}

async function readDeviceGrant(response: Response): Promise<DeviceGrant> {
  const body = (await response.json()) as Record<string, unknown> | null;
  if (!body || typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new Error('Sign-in approval returned an unexpected response.');
  }
  return {
    access_token: body.access_token,
    ...(typeof body.account_id === 'string' ? { account_id: body.account_id } : {}),
    ...(typeof body.account_name === 'string' ? { account_name: body.account_name } : {}),
  };
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as unknown;
    if (
      body &&
      typeof body === 'object' &&
      typeof (body as { error?: unknown }).error === 'string'
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // A non-JSON error body has no error code; the caller reports the HTTP status instead.
  }
  return undefined;
}

function isDeviceLogin(value: unknown): value is DeviceLogin {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const login = value as Record<string, unknown>;
  return (
    typeof login.login_token === 'string' &&
    typeof login.device_code === 'string' &&
    typeof login.user_code === 'string' &&
    typeof login.verification_uri_complete === 'string' &&
    typeof login.expires_in === 'number' &&
    typeof login.interval === 'number'
  );
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
