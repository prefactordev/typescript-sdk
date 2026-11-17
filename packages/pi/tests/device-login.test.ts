import { describe, expect, test } from 'bun:test';
import {
  type DeviceLogin,
  LoginCancelledError,
  pollForDeviceGrant,
  startDeviceLogin,
} from '../src/device-login.js';

const API_URL = 'https://prefactor.example';
const LOGIN: DeviceLogin = {
  login_token: 'login',
  device_code: 'device',
  user_code: 'ABCD',
  verification_uri_complete: `${API_URL}/cli/connect`,
  verification_qr_code: 'QR',
  expires_in: 600,
  interval: 2,
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers token polls in order and records each sleep. */
function pollDeps(replies: Response[]) {
  const sleeps: number[] = [];
  let clock = 0;
  return {
    sleeps,
    deps: {
      fetch: (async () =>
        replies.shift() ??
        reply(400, { error: 'authorization_pending' })) as unknown as typeof fetch,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
    },
  };
}

describe('startDeviceLogin', () => {
  test('reports a server without browser sign-in as unsupported', async () => {
    const fetchImpl = (async () => reply(404, { error: 'not_found' })) as unknown as typeof fetch;
    expect(await startDeviceLogin(API_URL, 'test', { fetch: fetchImpl })).toBe('unsupported');
  });
});

describe('pollForDeviceGrant', () => {
  test('waits longer after slow_down and returns the grant once approved', async () => {
    const { sleeps, deps } = pollDeps([
      reply(400, { error: 'authorization_pending' }),
      reply(400, { error: 'slow_down' }),
      reply(200, { access_token: 'account-token', account_id: 'acc', account_name: 'Acme' }),
    ]);

    const grant = await pollForDeviceGrant(API_URL, LOGIN, new AbortController().signal, deps);

    expect(grant).toEqual({
      access_token: 'account-token',
      account_id: 'acc',
      account_name: 'Acme',
    });
    expect(sleeps).toEqual([2_000, 2_000, 7_000]);
  });

  test('waits longer after slow_down sent with HTTP 429', async () => {
    const { sleeps, deps } = pollDeps([
      reply(429, { error: 'slow_down' }),
      reply(200, { access_token: 'account-token' }),
    ]);

    await pollForDeviceGrant(API_URL, LOGIN, new AbortController().signal, deps);

    expect(sleeps).toEqual([2_000, 7_000]);
  });

  test('fails when the sign-in is denied or expires', async () => {
    const denied = pollDeps([reply(400, { error: 'access_denied' })]);
    await expect(
      pollForDeviceGrant(API_URL, LOGIN, new AbortController().signal, denied.deps)
    ).rejects.toThrow('denied');

    const expired = pollDeps([]);
    await expect(
      pollForDeviceGrant(
        API_URL,
        { ...LOGIN, expires_in: 5 },
        new AbortController().signal,
        expired.deps
      )
    ).rejects.toThrow('expired');
  });

  test('stops with LoginCancelledError when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps } = pollDeps([]);
    await expect(
      pollForDeviceGrant(API_URL, LOGIN, controller.signal, deps)
    ).rejects.toBeInstanceOf(LoginCancelledError);
  });
});
