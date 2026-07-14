#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { generateVersionModules } from './generate-versions.ts';
import { ROOT } from './package-config.ts';

type PackageJson = {
  version: string;
};

type OpenClawPluginJson = {
  version: string;
};

async function syncOpenClawPluginVersion(): Promise<void> {
  const packageJsonPath = join(ROOT, 'packages/openclaw-prefactor-plugin/package.json');
  const pluginJsonPath = join(ROOT, 'packages/openclaw-prefactor-plugin/openclaw.plugin.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as PackageJson;
  const pluginJson = JSON.parse(await readFile(pluginJsonPath, 'utf8')) as OpenClawPluginJson;

  if (pluginJson.version === packageJson.version) {
    return;
  }

  pluginJson.version = packageJson.version;
  await writeFile(pluginJsonPath, `${JSON.stringify(pluginJson, null, 2)}\n`);
}

await $`changeset version`;
await generateVersionModules();
await syncOpenClawPluginVersion();
