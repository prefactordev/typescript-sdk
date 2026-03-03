import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { createCli } from '../src/cli.js';
import { buildLoginUrl, registerLoginCommand, validateToken } from '../src/commands/login.js';
import { DEFAULT_BASE_URL, DEFAULT_PROFILE_NAME, ProfileManager } from '../src/profile-manager.js';

describe('buildLoginUrl', () => {
  test('appends /cli-login to plain base URL', () => {
    expect(buildLoginUrl('https://app.prefactorai.com')).toBe('https://app.prefactorai.com/cli-login');
  });

  test('strips trailing slash before appending', () => {
    expect(buildLoginUrl('https://app.prefactorai.com/')).toBe('https://app.prefactorai.com/cli-login');
  });

  test('strips multiple trailing slashes', () => {
    expect(buildLoginUrl('https://app.prefactorai.com///')).toBe('https://app.prefactorai.com/cli-login');
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
  const originalHome = process.env.HOME;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-login-test-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('saves token to default profile with DEFAULT_BASE_URL when no profile exists', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const openBrowser = mock(() => {});
    const promptForToken = mock(async () => 'my-token');

    const program = new Command();
    program.exitOverride();
    registerLoginCommand(program, { openBrowser, promptForToken });

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
      registerLoginCommand(program, { openBrowser, promptForToken });
      await program.parseAsync(['node', 'prefactor', 'login']);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join('\n')).toContain(`Opening your browser to: ${buildLoginUrl(DEFAULT_BASE_URL)}`);
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
      registerLoginCommand(program, { openBrowser, promptForToken });
      await program.parseAsync(['node', 'prefactor', 'login']);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join('\n')).toContain('https://custom.example.com/cli-login');
    expect(openBrowser).toHaveBeenCalledWith('https://custom.example.com/cli-login');

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
    registerLoginCommand(program, { openBrowser, promptForToken });
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
    registerLoginCommand(program, { openBrowser, promptForToken });

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
      registerLoginCommand(program, { openBrowser, promptForToken });
      await program.parseAsync(['node', 'prefactor', 'login']);
    } finally {
      console.log = originalLog;
    }

    expect(logs.join('\n')).toContain(
      `Authentication successful. Credentials saved to the '${DEFAULT_PROFILE_NAME}' profile.`
    );
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
