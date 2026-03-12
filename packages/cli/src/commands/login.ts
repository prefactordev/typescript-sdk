import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { DEFAULT_BASE_URL, DEFAULT_PROFILE_NAME, ProfileManager } from '../profile-manager.js';

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
    .action(async () => {
      const manager = await ProfileManager.create();
      const existing = manager.getProfile(DEFAULT_PROFILE_NAME);
      const baseUrl = existing?.base_url ?? DEFAULT_BASE_URL;
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
    });
}
