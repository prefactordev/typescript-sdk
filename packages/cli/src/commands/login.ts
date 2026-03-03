import { exec } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Command } from 'commander';
import { DEFAULT_BASE_URL, DEFAULT_PROFILE_NAME, ProfileManager } from '../profile-manager.js';

export function buildLoginUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/cli-login`;
}

function openBrowserImpl(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`); // fire-and-forget; errors silently ignored
}

async function promptForTokenImpl(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function validateToken(token: string): void {
  if (token.length === 0) {
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
      console.log(`Authentication successful. Credentials saved to the '${DEFAULT_PROFILE_NAME}' profile.`);
    });
}
