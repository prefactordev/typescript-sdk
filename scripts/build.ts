#!/usr/bin/env bun

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';

const ROOT = import.meta.dir.replace('/scripts', '');

interface PackageConfig {
  name: string;
  path: string;
  entrypoint: string;
  external: string[];
}

const packages: PackageConfig[] = [
  {
    name: '@prefactor/core',
    path: 'packages/core',
    entrypoint: './packages/core/src/index.ts',
    external: ['@prefactor/pfid', 'zod'],
  },
  {
    name: '@prefactor/langchain',
    path: 'packages/langchain',
    entrypoint: './packages/langchain/src/index.ts',
    external: ['@prefactor/core', '@prefactor/pfid', '@langchain/core', 'langchain', 'zod'],
  },
  {
    name: '@prefactor/sdk',
    path: 'packages/sdk',
    entrypoint: './packages/sdk/src/index.ts',
    external: [
      '@prefactor/core',
      '@prefactor/langchain',
      '@prefactor/pfid',
      '@langchain/core',
      'langchain',
      'zod',
    ],
  },
];

async function buildPackage(pkg: PackageConfig): Promise<void> {
  const pkgDir = join(ROOT, pkg.path);
  const distDir = join(pkgDir, 'dist');
  const tmpDir = join(pkgDir, 'dist-tmp');

  console.log(`\n📦 Building ${pkg.name}...`);

  // Backup existing dist (contains .d.ts from tsc)
  if (existsSync(distDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
    cpSync(distDir, tmpDir, { recursive: true });
  }

  // Clean dist directory for bundling
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  // Bundle ESM
  console.log(`  📦 Bundling ESM...`);
  const esmResult = await Bun.build({
    entrypoints: [join(ROOT, pkg.entrypoint)],
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
    entrypoints: [join(ROOT, pkg.entrypoint)],
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

  // Copy type declarations from tmp back to dist
  if (existsSync(tmpDir)) {
    console.log(`  📄 Copying type declarations...`);
    await $`cp ${tmpDir}/index.d.ts ${distDir}/ 2>/dev/null || true`.quiet();
    await $`cp ${tmpDir}/index.d.ts.map ${distDir}/ 2>/dev/null || true`.quiet();
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`  ✅ ${pkg.name} built successfully`);
}

console.log('🏗️  Building @prefactor packages...\n');

// Clean all dist directories first
for (const pkg of packages) {
  const distDir = join(ROOT, pkg.path, 'dist');
  rmSync(distDir, { recursive: true, force: true });
}

// Compile TypeScript with tsc --build for project references
console.log('🔨 Compiling TypeScript...');
await $`tsc --build`;

// Build packages in dependency order
for (const pkg of packages) {
  await buildPackage(pkg);
}

console.log('\n✅ All packages built successfully!');
