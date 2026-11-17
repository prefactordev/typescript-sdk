/**
 * pi Example for @prefactor/pi
 *
 * Runs the `pi` command once in print mode with the Prefactor extension loaded from this
 * repository, so the session, its agent run, LLM responses and tool calls are recorded in
 * Prefactor. pi must be installed (`npm install -g @earendil-works/pi-coding-agent`) and set up
 * with a model, and `bun run build` must have been run so the extension's `dist` exists.
 *
 * Run:
 *   PREFACTOR_API_TOKEN=... bun examples/pi/print-mode.ts "List the files in this directory"
 *
 * Users install the published package with `pi install npm:@prefactor/pi` instead of `-e`.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

if (!process.env.PREFACTOR_API_TOKEN) {
  throw new Error(
    'PREFACTOR_API_TOKEN is required. Set PREFACTOR_API_URL too when not using https://app.prefactorai.com.'
  );
}

const prompt = process.argv[2] ?? 'List the files in this directory and summarise what they are.';
const extensionDir = join(import.meta.dir, '..', '..', 'packages', 'pi');

const result = spawnSync('pi', ['-p', '-e', extensionDir, '--no-session', prompt], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
