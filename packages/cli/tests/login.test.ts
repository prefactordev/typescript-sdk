import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { createCli } from '../src/cli.js';
import {
  browserOpenCommand,
  buildLoginUrl,
  qrCodeFits,
  registerLoginCommand,
  validateToken,
} from '../src/commands/login.js';
import { DEFAULT_BASE_URL, DEFAULT_PROFILE_NAME, ProfileManager } from '../src/profile-manager.js';

const pasteFallbackFetch = (async () => new Response('', { status: 404 })) as typeof fetch;

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('buildLoginUrl', () => {
  test('appends /cli/connect to plain base URL', () => {
    expect(buildLoginUrl('https://app.prefactorai.com')).toBe(
      'https://app.prefactorai.com/cli/connect'
    );
  });

  test('strips trailing slash before appending', () => {
    expect(buildLoginUrl('https://app.prefactorai.com/')).toBe(
      'https://app.prefactorai.com/cli/connect'
    );
  });

  test('strips multiple trailing slashes', () => {
    expect(buildLoginUrl('https://app.prefactorai.com///')).toBe(
      'https://app.prefactorai.com/cli/connect'
    );
  });
});

describe('browserOpenCommand', () => {
  const approvalUrl = 'https://app.prefactorai.com/cli/authorize?code=signed.login.token';

  test('opens an https URL without a shell on Windows', () => {
    expect(browserOpenCommand('win32', approvalUrl)).toEqual({
      command: 'rundll32',
      args: ['url.dll,FileProtocolHandler', approvalUrl],
    });
  });

  test('opens an https URL with the platform browser command', () => {
    expect(browserOpenCommand('darwin', approvalUrl)?.command).toBe('open');
    expect(browserOpenCommand('linux', approvalUrl)?.command).toBe('xdg-open');
  });

  test('refuses URLs that are not http or https', () => {
    expect(browserOpenCommand('win32', 'file:///C:/Windows/System32/calc.exe')).toBeUndefined();
    expect(browserOpenCommand('darwin', 'calc.exe & whoami')).toBeUndefined();
  });
});

describe('qrCodeFits', () => {
  const qrCode = '█▀▀▀█\n█▄▄▄█';

  test('fits only when the terminal is at least as wide as the code', () => {
    expect(qrCodeFits(qrCode, 5)).toBe(true);
    expect(qrCodeFits(qrCode, 4)).toBe(false);
  });

  test('does not fit when the terminal width is unknown', () => {
    expect(qrCodeFits(qrCode, undefined)).toBe(false);
  });
});

describe('validateToken', () => {
  test('accepts non-empty token without throwing', () => {
    expect(() => validateToken('my-api-token')).not.toThrow();
  });

  test('throws for empty string', () => {
    expect(() => validateToken('')).toThrow('No API token provided.');
  });
});

describe('login command action', () => {
  const originalCwd = process.cwd();
  const originalSelfPath = process.env.PREFACTOR_CLI_SELF_PATH;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-login-test-'));
    process.env.PREFACTOR_CLI_SELF_PATH = join(tempRoot, '.prefactor', 'bin', 'prefactor');
  });

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalSelfPath === undefined) {
      delete process.env.PREFACTOR_CLI_SELF_PATH;
    } else {
      process.env.PREFACTOR_CLI_SELF_PATH = originalSelfPath;
    }

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('saves token to executable-root default profile with DEFAULT_BASE_URL when no root profile exists', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const openBrowser = mock(() => {});
    const promptForToken = mock(async () => 'my-token');

    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, { openBrowser, promptForToken, fetch: pasteFallbackFetch });

    await program.parseAsync(['node', 'prefactor', 'login']);

    const manager = await ProfileManager.create();
    const profile = manager.getProfile(DEFAULT_PROFILE_NAME);
    expect(profile?.api_key).toBe('my-token');
    expect(profile?.base_url).toBe(DEFAULT_BASE_URL);
  });

  test('prints the correct login URL to stdout', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const openBrowser = mock(() => {});
    const promptForToken = mock(async () => 'my-token');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = new Command();
      program.exitOverride();
      registerLoginCommand(program, { openBrowser, promptForToken, fetch: pasteFallbackFetch });
      await program.parseAsync(['node', 'prefactor', 'login']);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join('\n')).toContain(
      `Opening your browser to: ${buildLoginUrl(DEFAULT_BASE_URL)}`
    );
  });

  test('uses existing default profile custom base_url for login URL and preserves it on save', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'old-token', base_url: 'https://custom.example.com' },
      })
    );
    process.chdir(cwd);

    const openBrowser = mock(() => {});
    const promptForToken = mock(async () => 'new-token');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = new Command();
      program.exitOverride();
      registerLoginCommand(program, { openBrowser, promptForToken, fetch: pasteFallbackFetch });
      await program.parseAsync(['node', 'prefactor', 'login']);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join('\n')).toContain('https://custom.example.com/cli/connect');
    expect(openBrowser).toHaveBeenCalledWith('https://custom.example.com/cli/connect');

    const manager = await ProfileManager.create();
    const profile = manager.getProfile(DEFAULT_PROFILE_NAME);
    expect(profile?.api_key).toBe('new-token');
    expect(profile?.base_url).toBe('https://custom.example.com');
  });

  test('calls openBrowser with the derived URL', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const openBrowser = mock(() => {});
    const promptForToken = mock(async () => 'my-token');

    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, { openBrowser, promptForToken, fetch: pasteFallbackFetch });
    await program.parseAsync(['node', 'prefactor', 'login']);

    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(openBrowser).toHaveBeenCalledWith(buildLoginUrl(DEFAULT_BASE_URL));
  });

  test('throws when pasted token is blank', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const openBrowser = mock(() => {});
    const promptForToken = mock(async () => '');

    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, { openBrowser, promptForToken, fetch: pasteFallbackFetch });

    await expect(program.parseAsync(['node', 'prefactor', 'login'])).rejects.toThrow(
      'No API token provided.'
    );
  });

  test('prints success message after saving', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const openBrowser = mock(() => {});
    const promptForToken = mock(async () => 'my-token');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = new Command();
      program.exitOverride();
      registerLoginCommand(program, { openBrowser, promptForToken, fetch: pasteFallbackFetch });
      await program.parseAsync(['node', 'prefactor', 'login']);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join('\n')).toContain(
      `Authentication successful. Credentials saved to the '${DEFAULT_PROFILE_NAME}' profile.`
    );
  });
});

describe('device login', () => {
  const originalCwd = process.cwd();
  const originalSelfPath = process.env.PREFACTOR_CLI_SELF_PATH;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-device-login-test-'));
    process.env.PREFACTOR_CLI_SELF_PATH = join(tempRoot, '.prefactor', 'bin', 'prefactor');
  });

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalSelfPath === undefined) {
      delete process.env.PREFACTOR_CLI_SELF_PATH;
    } else {
      process.env.PREFACTOR_CLI_SELF_PATH = originalSelfPath;
    }

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  const clientInfo = {
    client_version: '9.9.9',
    platform: 'test-platform',
    hostname: 'test-host',
  };

  function useTempDir(): void {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
  }

  function writeCustomProfile(): void {
    writeFileSync(
      join(process.cwd(), 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'old-token', base_url: 'https://custom.example.com' },
      })
    );
  }

  const approvalUrl = 'https://custom.example.com/cli/authorize?code=signed.login.token';
  const qrCode = '█▀▀█\n█▄▄█';

  function startPayload() {
    return {
      login_token: 'signed.login.token',
      device_code: 'device-secret',
      user_code: 'ABCD-EFGH',
      verification_uri_complete: approvalUrl,
      verification_qr_code: qrCode,
      expires_in: 600,
      interval: 5,
    };
  }

  test('prints the link without the QR code when the terminal is too narrow', async () => {
    useTempDir();
    writeCustomProfile();

    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/cli/login/start')) {
        return jsonResponse(startPayload());
      }
      return jsonResponse({ access_token: 'approved-token', token_type: 'Bearer' });
    }) as typeof fetch;

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const program = new Command();
      program.exitOverride();
      registerLoginCommand(program, {
        openBrowser: mock(() => {}),
        promptForToken: mock(async () => 'pasted-token'),
        fetch: fetchImpl,
        sleep: async () => {},
        clientInfo,
        terminalColumns: () => 3,
      });
      await program.parseAsync(['node', 'prefactor', 'login']);
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    expect(output).not.toContain(qrCode);
    expect(output).not.toContain('scan the QR code');
    expect(output).toContain(`Opening your browser to approve this login: ${approvalUrl}`);
  });

  test('saves the approved access token and does not ask for a pasted token', async () => {
    useTempDir();
    writeCustomProfile();

    const calls: Array<{ url: string; body: string }> = [];
    const openBrowser = mock(() => {});
    const promptForToken = mock(async () => 'pasted-token');
    let polls = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? '') });
      if (url.endsWith('/cli/login/start')) {
        return jsonResponse(startPayload());
      }
      polls += 1;
      if (polls === 1) {
        return jsonResponse({ error: 'authorization_pending' }, 400);
      }
      return jsonResponse({
        access_token: 'approved-token',
        token_type: 'Bearer',
        account_id: 'account_1',
        account_name: 'Example account',
      });
    }) as typeof fetch;

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    const sleeps: number[] = [];

    try {
      const program = new Command();
      program.exitOverride();
      registerLoginCommand(program, {
        openBrowser,
        promptForToken,
        fetch: fetchImpl,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        clientInfo,
        terminalColumns: () => 80,
      });
      await program.parseAsync(['node', 'prefactor', 'login']);
    } finally {
      console.log = originalLog;
    }

    expect(promptForToken).not.toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledWith(approvalUrl);
    expect(calls[0]?.url).toBe('https://custom.example.com/cli/login/start');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual(clientInfo);
    expect(calls[1]?.url).toBe('https://custom.example.com/cli/login/token');
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      login_token: 'signed.login.token',
      device_code: 'device-secret',
    });
    expect(sleeps).toEqual([5000, 5000]);

    const output = logs.join('\n');
    expect(output).toContain(qrCode);
    expect(output).toContain(`Opening your browser to approve this login: ${approvalUrl}`);
    expect(output).toContain('Confirm this code in the browser: ABCD-EFGH');
    expect(output).toContain('Signed in to Example account.');
    expect(output).not.toContain('device-secret');

    const manager = await ProfileManager.create();
    expect(manager.getProfile(DEFAULT_PROFILE_NAME)?.api_key).toBe('approved-token');
    expect(manager.getProfile(DEFAULT_PROFILE_NAME)?.base_url).toBe('https://custom.example.com');
  });

  test('waits longer after slow_down', async () => {
    useTempDir();

    let polls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/cli/login/start')) {
        return jsonResponse({
          ...startPayload(),
          verification_uri_complete:
            'https://app.prefactorai.com/cli/authorize?code=signed.login.token',
        });
      }
      polls += 1;
      if (polls === 1) {
        return jsonResponse({ error: 'slow_down' }, 400);
      }
      return jsonResponse({ access_token: 'approved-token', account_name: 'Example account' });
    }) as typeof fetch;

    const sleeps: number[] = [];
    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, {
      openBrowser: () => {},
      promptForToken: async () => 'unused',
      fetch: fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      clientInfo,
    });
    await program.parseAsync(['node', 'prefactor', 'login']);

    expect(sleeps).toEqual([5000, 10000]);
  });

  test('stops when the browser cancels the login', async () => {
    useTempDir();
    writeCustomProfile();

    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/cli/login/start')) {
        return jsonResponse(startPayload());
      }
      return jsonResponse({ error: 'access_denied' }, 400);
    }) as typeof fetch;

    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, {
      openBrowser: () => {},
      promptForToken: async () => 'unused',
      fetch: fetchImpl,
      sleep: async () => {},
      clientInfo,
    });

    await expect(program.parseAsync(['node', 'prefactor', 'login'])).rejects.toThrow(
      'The login was cancelled in the browser.'
    );

    const manager = await ProfileManager.create();
    expect(manager.getProfile(DEFAULT_PROFILE_NAME)?.api_key).toBe('old-token');
  });

  test('stops when the login token was already used', async () => {
    useTempDir();

    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/cli/login/start')) {
        return jsonResponse(startPayload());
      }
      return jsonResponse({ error: 'expired_token' }, 400);
    }) as typeof fetch;

    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, {
      openBrowser: () => {},
      promptForToken: async () => 'unused',
      fetch: fetchImpl,
      sleep: async () => {},
      clientInfo,
    });

    await expect(program.parseAsync(['node', 'prefactor', 'login'])).rejects.toThrow(
      'Login expired or was already used. Run prefactor login again.'
    );
  });

  test('cuts client details to the 64 characters the server accepts', async () => {
    useTempDir();

    const bodies: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/cli/login/start')) {
        bodies.push(String(init?.body ?? ''));
        return jsonResponse(startPayload());
      }
      return jsonResponse({ access_token: 'approved-token' });
    }) as typeof fetch;

    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, {
      openBrowser: () => {},
      promptForToken: async () => 'unused',
      fetch: fetchImpl,
      sleep: async () => {},
      clientInfo: {
        client_version: 'v'.repeat(70),
        platform: 'p'.repeat(70),
        hostname: 'h'.repeat(70),
      },
    });
    await program.parseAsync(['node', 'prefactor', 'login']);

    expect(JSON.parse(bodies[0] ?? '{}')).toEqual({
      client_version: 'v'.repeat(64),
      platform: 'p'.repeat(64),
      hostname: 'h'.repeat(64),
    });
  });

  test('rejects a start response without a login token', async () => {
    useTempDir();

    const { login_token: _loginToken, ...withoutLoginToken } = startPayload();
    const fetchImpl = (async () => jsonResponse(withoutLoginToken)) as typeof fetch;

    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, {
      openBrowser: () => {},
      promptForToken: async () => 'unused',
      fetch: fetchImpl,
      sleep: async () => {},
      clientInfo,
    });

    await expect(program.parseAsync(['node', 'prefactor', 'login'])).rejects.toThrow(
      'Login start returned an unexpected response.'
    );
  });

  test('stops when the login expires before approval', async () => {
    useTempDir();

    const calls: string[] = [];
    let clock = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ ...startPayload(), expires_in: 1, interval: 5 });
    }) as typeof fetch;

    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, {
      openBrowser: () => {},
      promptForToken: async () => 'unused',
      fetch: fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      clientInfo,
    });

    await expect(program.parseAsync(['node', 'prefactor', 'login'])).rejects.toThrow(
      'Login expired. Run prefactor login again.'
    );
    expect(calls).toEqual(['https://app.prefactorai.com/cli/login/start']);
  });
});

describe('CLI registration', () => {
  test("'login' appears in createCli commands with correct description", () => {
    const cli = createCli('1.0.0');
    const loginCommand = cli.commands.find((cmd) => cmd.name() === 'login');
    expect(loginCommand).toBeDefined();
    expect(loginCommand?.description()).toBe('Authenticate the CLI with your Prefactor account');
  });
});
