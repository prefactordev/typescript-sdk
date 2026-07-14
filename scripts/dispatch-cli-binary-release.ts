#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

function normalizeVersion(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) {
    throw new Error('Version must not be empty.');
  }

  const normalized = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Invalid version '${version}'. Expected semver like 0.0.5 or v0.0.5.`);
  }

  return normalized;
}

export function dispatchCliBinaryRelease(version: string, ref = 'main'): void {
  const normalized = normalizeVersion(version);
  const result = spawnSync(
    'gh',
    ['workflow', 'run', 'release-cli.yml', '--ref', ref, '--field', `version=${normalized}`],
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
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length !== 1) {
    console.log('Usage: bun scripts/dispatch-cli-binary-release.ts <version>');
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  dispatchCliBinaryRelease(args[0] ?? '');
  console.log(`Dispatched stable CLI release workflow for v${normalizeVersion(args[0] ?? '')}.`);
  console.log('Track it with: gh run list --workflow release-cli.yml --limit 1');
}
