import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex, withServer } from './install-test-helpers';

const PWSH = 'pwsh.exe';
const PWSH_BASE_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

async function runPwsh(
  args: string[],
  envOverrides?: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(PWSH, [...PWSH_BASE_ARGS, ...args], {
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

function escapePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function createZipArchive(inputPath: string, outputPath: string): void {
  const command = `Compress-Archive -LiteralPath '${escapePowerShellLiteral(inputPath)}' -DestinationPath '${escapePowerShellLiteral(outputPath)}' -Force`;
  const result = spawnSync(PWSH, [...PWSH_BASE_ARGS, '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(`Failed to create zip archive: ${result.stdout}\n${result.stderr}`.trim());
  }
}

function createFailingExecutable(outputPath: string): void {
  const result = spawnSync(PWSH, [...PWSH_BASE_ARGS, '-Command', '(Get-Command pwsh.exe).Source'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(`Failed to compile test executable: ${result.stdout}\n${result.stderr}`.trim());
  }

  const sourcePath = result.stdout.trim();
  if (!sourcePath) {
    throw new Error('Failed to resolve pwsh.exe for the test executable.');
  }

  copyFileSync(sourcePath, outputPath);
}

describe.if(process.platform === 'win32')('install.ps1', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'install.ps1');
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-install-ps-'));
  });

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('prints help', async () => {
    const result = await runPwsh(['-File', scriptPath, '-Help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Install the Prefactor CLI from GitHub Releases.');
  });

  test('fails clearly for unsupported architecture', async () => {
    const result = await runPwsh(['-File', scriptPath], {
      PREFACTOR_INSTALL_TEST_ARCH: 'sparc',
    });

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Unsupported architecture');
  });

  test('uses native OS architecture when running under WOW64-style environment variables', async () => {
    const capturePath = join(tempRoot, 'captured-native-arch-args.txt');
    const assetName = 'prefactor-windows-x64.zip';

    const archiveDir = join(tempRoot, 'archive-native');
    await mkdir(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, 'prefactor.exe'), 'fake exe');
    const archivePath = join(tempRoot, assetName);
    createZipArchive(join(archiveDir, 'prefactor.exe'), archivePath);
    const archiveBuffer = Buffer.from(readFileSync(archivePath));
    const checksum = `${sha256Hex(archiveBuffer)}  ${assetName}\n`;
    const requests: string[] = [];

    const server = await withServer((req, res) => {
      requests.push(req.url ?? '');
      if (req.url?.endsWith(assetName)) {
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        res.end(archiveBuffer);
        return;
      }
      if (req.url?.endsWith('/SHA256SUMS')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(checksum);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    try {
      const result = await runPwsh(['-File', scriptPath, 'stable'], {
        PREFACTOR_INSTALL_TEST_CAPTURE_ARGS: capturePath,
        PREFACTOR_RELEASE_BASE_URL: `${server.url}/releases/download`,
        PREFACTOR_RELEASE_LATEST_BASE_URL: `${server.url}/releases/latest/download`,
        PROCESSOR_ARCHITECTURE: 'x86',
        PROCESSOR_ARCHITEW6432: 'AMD64',
      });

      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/latest/download/prefactor-windows-x64.zip');
      expect(readFileSync(capturePath, 'utf8')).toContain('--channel');
    } finally {
      await server.close();
    }
  });

  test('fails on checksum mismatch before running the installer', async () => {
    const assetName = 'prefactor-windows-x64.zip';
    const archiveDir = join(tempRoot, 'archive');
    await mkdir(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, 'prefactor.exe'), 'fake exe');
    const archivePath = join(tempRoot, assetName);
    createZipArchive(join(archiveDir, 'prefactor.exe'), archivePath);
    const archiveBuffer = Buffer.from(readFileSync(archivePath));

    const server = await withServer((req, res) => {
      if (req.url?.endsWith(assetName)) {
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        res.end(archiveBuffer);
        return;
      }
      if (req.url?.endsWith('/SHA256SUMS')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`0000000000000000000000000000000000000000000000000000000000000000  ${assetName}\n`);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    try {
      const result = await runPwsh(['-File', scriptPath], {
        PREFACTOR_INSTALL_TEST_ARCH: 'x64',
        PREFACTOR_RELEASE_BASE_URL: `${server.url}/releases/download`,
        PREFACTOR_RELEASE_LATEST_BASE_URL: `${server.url}/releases/latest/download`,
      });

      expect(result.code).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('Checksum mismatch');
    } finally {
      await server.close();
    }
  });

  test('propagates installer exit failures', async () => {
    const assetName = 'prefactor-windows-x64.zip';
    const archiveDir = join(tempRoot, 'archive-failing-installer');
    await mkdir(archiveDir, { recursive: true });
    createFailingExecutable(join(archiveDir, 'prefactor.exe'));
    const archivePath = join(tempRoot, assetName);
    createZipArchive(join(archiveDir, 'prefactor.exe'), archivePath);
    const archiveBuffer = Buffer.from(readFileSync(archivePath));
    const checksum = `${sha256Hex(archiveBuffer)}  ${assetName}\n`;

    const server = await withServer((req, res) => {
      if (req.url?.endsWith(assetName)) {
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        res.end(archiveBuffer);
        return;
      }
      if (req.url?.endsWith('/SHA256SUMS')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(checksum);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    try {
      const result = await runPwsh(['-File', scriptPath], {
        PREFACTOR_INSTALL_TEST_ARCH: 'x64',
        PREFACTOR_RELEASE_BASE_URL: `${server.url}/releases/download`,
        PREFACTOR_RELEASE_LATEST_BASE_URL: `${server.url}/releases/latest/download`,
      });

      expect(result.code).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('Installer failed with exit code');
    } finally {
      await server.close();
    }
  });

  test('uses stable, latest, and pinned URLs and builds installer args', async () => {
    const requests: string[] = [];
    const capturePath = join(tempRoot, 'captured-args.txt');
    const assetName = 'prefactor-windows-x64.zip';

    const archiveDir = join(tempRoot, 'archive');
    await mkdir(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, 'prefactor.exe'), 'fake exe');
    const archivePath = join(tempRoot, assetName);
    createZipArchive(join(archiveDir, 'prefactor.exe'), archivePath);
    const archiveBuffer = Buffer.from(readFileSync(archivePath));
    const checksum = `${sha256Hex(archiveBuffer)}  ${assetName}\n`;

    const server = await withServer((req, res) => {
      requests.push(req.url ?? '');
      if (req.url?.endsWith(assetName)) {
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        res.end(archiveBuffer);
        return;
      }
      if (req.url?.endsWith('/SHA256SUMS')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(checksum);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    try {
      const env = {
        PREFACTOR_INSTALL_TEST_ARCH: 'x64',
        PREFACTOR_INSTALL_TEST_CAPTURE_ARGS: capturePath,
        PREFACTOR_RELEASE_BASE_URL: `${server.url}/releases/download`,
        PREFACTOR_RELEASE_LATEST_BASE_URL: `${server.url}/releases/latest/download`,
      };

      let result = await runPwsh(['-File', scriptPath, 'stable'], env);
      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/latest/download/prefactor-windows-x64.zip');
      expect(readFileSync(capturePath, 'utf8')).toContain('--channel');

      requests.length = 0;
      result = await runPwsh(['-File', scriptPath, 'latest'], env);
      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/download/canary/prefactor-windows-x64.zip');
      expect(readFileSync(capturePath, 'utf8')).toContain('canary');

      requests.length = 0;
      result = await runPwsh(['-File', scriptPath, '0.0.4'], env);
      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/download/v0.0.4/prefactor-windows-x64.zip');
      expect(readFileSync(capturePath, 'utf8')).toContain('--version');
    } finally {
      await server.close();
    }
  });
});
