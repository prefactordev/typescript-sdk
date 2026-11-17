import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Manifest = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readManifest(packageDir: string): Manifest {
  return JSON.parse(
    readFileSync(join(import.meta.dir, '..', '..', packageDir, 'package.json'), 'utf-8')
  ) as Manifest;
}

describe('@prefactor/pi package manifest', () => {
  // `pi install` runs npm with --legacy-peer-deps, which skips peer dependencies, so the
  // extension must install @prefactor/core's peers itself or it cannot load.
  test("depends on each of @prefactor/core's peer dependencies", () => {
    const core = readManifest('core');
    const pi = readManifest('pi');

    for (const [name, range] of Object.entries(core.peerDependencies ?? {})) {
      expect(pi.dependencies?.[name]).toBe(range);
    }
  });
});
