#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import packageJson from '../packages/cli/package.json';

function usage(exitCode: 0 | 1): never {
  const stream = exitCode === 0 ? console.log : console.error;
  stream('Usage: bun scripts/release-cli-stable.ts [version]');
  stream('');
  stream('Examples:');
  stream(`  bun scripts/release-cli-stable.ts`);
  stream(`  bun scripts/release-cli-stable.ts ${packageJson.version}`);
  process.exit(exitCode);
}

function normalizeVersion(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) {
    usage(1);
  }

  const normalized = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Invalid version '${version}'. Expected semver like 0.0.5 or v0.0.5.`);
  }

  return normalized;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage(0);
}
if (args.length > 1) {
  usage(1);
}

const version = normalizeVersion(args[0] ?? packageJson.version);
if (version !== packageJson.version) {
  throw new Error(
    `Requested version ${version} does not match @prefactor/cli package version ${packageJson.version}.`
  );
}

const result = spawnSync(
  'gh',
  ['workflow', 'run', 'release-cli.yml', '--ref', 'main', '--field', `version=${version}`],
  {
    stdio: 'inherit',
  }
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Dispatched stable CLI release workflow for v${version}.`);
console.log('Track it with: gh run list --workflow release-cli.yml --limit 1');
