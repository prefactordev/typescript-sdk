#!/usr/bin/env bun

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';
import { generateVersionModules } from './generate-versions.ts';
import { PACKAGE_CONFIGS, type PackageConfig, ROOT } from './package-config.ts';

async function buildPackage(pkg: PackageConfig): Promise<void> {
  const pkgDir = join(ROOT, pkg.path);
  const distDir = join(pkgDir, 'dist');
  const configuredEntrypoints = pkg.entrypoints ?? (pkg.entrypoint ? [pkg.entrypoint] : []);
  if (configuredEntrypoints.length === 0) {
    throw new Error(`No entrypoints configured for ${pkg.name}`);
  }

  const entrypoints = configuredEntrypoints.map((entrypoint) => join(ROOT, entrypoint));

  console.log(`\n📦 Building ${pkg.name}...`);

  // Ensure dist directory exists
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  // Bundle ESM
  console.log(`  📦 Bundling ESM...`);
  const esmResult = await Bun.build({
    entrypoints,
    outdir: distDir,
    target: 'node',
    format: 'esm',
    sourcemap: 'external',
    minify: false,
    external: pkg.external,
  });

  if (!esmResult.success) {
    console.error(`  ❌ ESM build failed:`, esmResult.logs);
    process.exit(1);
  }

  // Bundle CommonJS
  console.log(`  📦 Bundling CommonJS...`);
  const cjsResult = await Bun.build({
    entrypoints,
    outdir: distDir,
    target: 'node',
    format: 'cjs',
    naming: '[dir]/[name].cjs',
    sourcemap: 'external',
    minify: false,
    external: pkg.external,
  });

  if (!cjsResult.success) {
    console.error(`  ❌ CJS build failed:`, cjsResult.logs);
    process.exit(1);
  }

  console.log(`  ✅ ${pkg.name} built successfully`);
}

console.log('🏗️  Building @prefactor packages...\n');

console.log('📝 Generating SDK version modules...');
await generateVersionModules();

// Clean all dist directories first
for (const pkg of PACKAGE_CONFIGS) {
  const distDir = join(ROOT, pkg.path, 'dist');
  rmSync(distDir, { recursive: true, force: true });
}

// Compile TypeScript with tsc --build for type declarations
// --force ensures clean rebuild after dist directories are cleaned
console.log('🔨 Compiling TypeScript declarations...');
await $`tsc --build --force`;

// Build packages in dependency order (Bun bundler for JS)
for (const pkg of PACKAGE_CONFIGS) {
  await buildPackage(pkg);
}

console.log('\n✅ All packages built successfully!');
