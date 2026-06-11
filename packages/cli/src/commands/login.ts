import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { DEFAULT_BASE_URL, DEFAULT_PROFILE_NAME, ProfileManager } from '../profile-manager.js';
import { validateBaseUrl } from './shared.js';

export function buildLoginUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/cli/connect`;
}

function openBrowserImpl(url: string): void {
  let cmd: string;
  let args: string[];

  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
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

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function profileNameFromBaseUrl(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

export function resolveLoginProfileName(
  manager: Pick<ProfileManager, 'getProfile' | 'getProfileEntries'>,
  baseUrl: string
): string {
  const normalizedUrl = normalizeBaseUrl(baseUrl);
  const existingDefault = manager.getProfile(DEFAULT_PROFILE_NAME);

  if (!existingDefault) {
    return DEFAULT_PROFILE_NAME;
  }

  if (normalizeBaseUrl(existingDefault.base_url) === normalizedUrl) {
    return DEFAULT_PROFILE_NAME;
  }

  for (const [name, profile] of manager.getProfileEntries()) {
    if (normalizeBaseUrl(profile.base_url) === normalizedUrl) {
      return name;
    }
  }

  const derivedName = profileNameFromBaseUrl(baseUrl);
  const existingDerived = manager.getProfile(derivedName);
  if (existingDerived && normalizeBaseUrl(existingDerived.base_url) !== normalizedUrl) {
    throw new Error(
      `Profile '${derivedName}' already exists with a different base URL. Use 'prefactor profiles add <name> [baseUrl] --api-token <apiToken>' instead.`
    );
  }

  return derivedName;
}

export interface LoginDeps {
  openBrowser: (url: string) => void;
  promptForToken: (prompt: string) => Promise<string>;
}

const defaultDeps: LoginDeps = {
  openBrowser: openBrowserImpl,
  promptForToken: promptForTokenImpl,
};

export function registerLoginCommand(program: Command, deps: LoginDeps = defaultDeps): void {
  program
    .command('login')
    .description('Authenticate the CLI with your Prefactor account')
    .option('--base-url <baseUrl>', 'Prefactor app URL for the login flow')
    .action(async (options: { baseUrl?: string }) => {
      const manager = await ProfileManager.create();
      const existing = manager.getProfile(DEFAULT_PROFILE_NAME);
      const baseUrl = options.baseUrl ?? existing?.base_url ?? DEFAULT_BASE_URL;
      validateBaseUrl(baseUrl);
      const loginUrl = buildLoginUrl(baseUrl);

      console.log(`Opening your browser to: ${loginUrl}`);
      console.log('If the browser does not open automatically, visit the URL above.');
      deps.openBrowser(loginUrl);
      console.log('');
      console.log('After authenticating, copy your API token from the browser.');

      const token = await deps.promptForToken('Paste your API token here: ');
      validateToken(token);

      const profileName = resolveLoginProfileName(manager, baseUrl);
      await manager.addProfile(profileName, token, baseUrl);
      console.log(`Authentication successful. Credentials saved to the '${profileName}' profile.`);
    });
}
