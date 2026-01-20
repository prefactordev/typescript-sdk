#!/usr/bin/env bun

import { $ } from 'bun';
import { rmSync, cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

console.log('🏗️  Building @prefactor/sdk...\n');

// Clean dist directory
console.log('📦 Cleaning dist directory...');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

// Compile TypeScript with tsc
console.log('🔨 Compiling TypeScript...');
await $`tsc`;

// Bundle ESM
console.log('📦 Bundling ESM...');
const esmResult = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  sourcemap: 'external',
  minify: false,
  external: ['@langchain/core', 'langchain', 'zod'],
});

if (!esmResult.success) {
  console.error('❌ ESM build failed:', esmResult.logs);
  process.exit(1);
}

// Bundle CommonJS
console.log('📦 Bundling CommonJS...');
const cjsResult = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'node',
  format: 'cjs',
  naming: '[dir]/[name].cjs',
  sourcemap: 'external',
  minify: false,
  external: ['@langchain/core', 'langchain', 'zod'],
});

if (!cjsResult.success) {
  console.error('❌ CJS build failed:', cjsResult.logs);
  process.exit(1);
}

// Copy metadata files
console.log('📄 Copying metadata files...');
const filesToCopy = ['package.json', 'README.md', 'LICENSE'];

for (const file of filesToCopy) {
  if (existsSync(file)) {
    cpSync(file, join('dist', file));
  }
}

console.log('\n✅ Build completed successfully!');
