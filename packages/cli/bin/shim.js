#!/usr/bin/env node
'use strict';

const { existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const pkgRoot = join(__dirname, '..');
const isWindows = process.platform === 'win32';
const nativeBin = join(pkgRoot, 'bin', isWindows ? 'prefactor.exe' : 'prefactor');

if (existsSync(nativeBin)) {
  try {
    execFileSync(nativeBin, process.argv.slice(2), { stdio: 'inherit' });
    process.exitCode = 0;
  } catch (err) {
    process.exitCode = err.status ?? 1;
  }
} else {
  // Fallback: spawn Node.js with the compiled JS bundle
  const cliBin = join(pkgRoot, 'dist', 'bin', 'cli.js');
  try {
    execFileSync(process.execPath, [cliBin, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exitCode = 0;
  } catch (err) {
    process.exitCode = err.status ?? 1;
  }
}
