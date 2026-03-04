'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, chmodSync, renameSync } = require('node:fs');
const { join } = require('node:path');

const REPO = 'prefactordev/typescript-sdk';
const { version } = require('../package.json');

// Map Node.js platform/arch -> GitHub Release asset filename
const ASSET_MAP = {
  'linux-x64':    'prefactor-linux-x64',
  'linux-arm64':  'prefactor-linux-arm64',
  'darwin-x64':   'prefactor-macos-x64',
  'darwin-arm64': 'prefactor-macos-arm64',
  'win32-x64':    'prefactor-windows-x64.exe',
  'win32-arm64':  'prefactor-windows-arm64.exe',
};

function main() {
  if (process.env.SKIP_PREFACTOR_POSTINSTALL === '1') {
    return;
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const asset = ASSET_MAP[platformKey];

  if (!asset) {
    // Unsupported platform — shim will fall back to Node.js
    return;
  }

  const pkgRoot = join(__dirname, '..');
  const binDir = join(pkgRoot, 'bin');
  const isWindows = process.platform === 'win32';
  const binName = isWindows ? 'prefactor.exe' : 'prefactor';
  const destPath = join(binDir, binName);

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }

  const url = `https://github.com/${REPO}/releases/download/v${version}/${asset}`;
  const tmpPath = `${destPath}.tmp`;

  console.log(`[prefactor] Downloading binary for ${platformKey}...`);

  // Try curl first, then wget
  let downloaded = false;
  if (commandExists('curl')) {
    const result = spawnSync('curl', ['-fsSL', '-o', tmpPath, url], { stdio: 'inherit' });
    downloaded = result.status === 0;
  } else if (commandExists('wget')) {
    const result = spawnSync('wget', ['-qO', tmpPath, url], { stdio: 'inherit' });
    downloaded = result.status === 0;
  }

  if (!downloaded) {
    console.log('[prefactor] Could not download binary; will use Node.js fallback');
    return;
  }

  renameSync(tmpPath, destPath);
  if (!isWindows) {
    chmodSync(destPath, 0o755);
  }
  console.log(`[prefactor] Native binary installed (${platformKey})`);
}

function commandExists(cmd) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

main();
