import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scriptPath = join(process.cwd(), 'scripts', 'install.sh');

function sha256Hex(contents: Buffer): string {
  return new Bun.CryptoHasher('sha256').update(contents).digest('hex');
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolvePromise) =>
    server.listen(0, '127.0.0.1', () => resolvePromise())
  );
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise()))
      ),
  };
}

async function runCommand(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
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
    child.on('exit', (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

describe('install.sh', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-install-bootstrap-'));
  });

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('prints help', () => {
    const result = spawnSync(
      'bash',
      [scriptPath, '--help'],
      {
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Install the Prefactor CLI from GitHub Releases.');
  });

  test('fails clearly when no downloader is available', () => {
    const result = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PREFACTOR_INSTALL_TEST_NO_DOWNLOADERS: '1',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Either curl or wget is required.');
  });

  test('fails clearly for unsupported OS', () => {
    const result = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PREFACTOR_INSTALL_TEST_UNAME_S: 'Plan9',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsupported operating system');
  });

  test('fails on checksum mismatch before running the installer', async () => {
    const assetName = 'prefactor-linux-x64.tar.gz';
    const archiveDir = join(tempRoot, 'archive');
    await mkdir(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, 'prefactor'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const archivePath = join(tempRoot, assetName);
    spawnSync('tar', ['-czf', archivePath, '-C', archiveDir, 'prefactor']);
    const archiveBuffer = Buffer.from(readFileSync(archivePath));

    const server = await withServer((req, res) => {
      if (req.url?.endsWith(assetName)) {
        res.writeHead(200, { 'Content-Type': 'application/gzip' });
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
      const result = await runCommand(
        'bash',
        [scriptPath],
        {
          ...process.env,
          PREFACTOR_INSTALL_TEST_UNAME_S: 'Linux',
          PREFACTOR_INSTALL_TEST_UNAME_M: 'x86_64',
          PREFACTOR_INSTALL_TEST_LIBC: 'glibc',
          PREFACTOR_RELEASE_BASE_URL: `${server.url}/releases/download`,
          PREFACTOR_RELEASE_LATEST_BASE_URL: `${server.url}/releases/latest/download`,
        }
      );

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('Checksum mismatch');
    } finally {
      await server.close();
    }
  });

  test('uses stable, latest, and pinned URLs and invokes the extracted installer', async () => {
    const requests: string[] = [];
    const childLog = join(tempRoot, 'child.log');
    const assetName = 'prefactor-linux-x64.tar.gz';

    const archiveDir = join(tempRoot, 'archive');
    await mkdir(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, 'prefactor'),
      `#!/usr/bin/env bash\nprintf '%s\n' "$@" > "${childLog}"\nexit 0\n`,
      { mode: 0o755 }
    );
    const archivePath = join(tempRoot, assetName);
    spawnSync('tar', ['-czf', archivePath, '-C', archiveDir, 'prefactor']);
    const archiveBuffer = Buffer.from(readFileSync(archivePath));
    const checksum = `${sha256Hex(archiveBuffer)}  ${assetName}\n`;

    const server = await withServer((req, res) => {
      requests.push(req.url ?? '');
      if (req.url?.endsWith(assetName)) {
        res.writeHead(200, { 'Content-Type': 'application/gzip' });
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
        ...process.env,
        PREFACTOR_INSTALL_TEST_UNAME_S: 'Linux',
        PREFACTOR_INSTALL_TEST_UNAME_M: 'x86_64',
        PREFACTOR_INSTALL_TEST_LIBC: 'glibc',
        PREFACTOR_RELEASE_BASE_URL: `${server.url}/releases/download`,
        PREFACTOR_RELEASE_LATEST_BASE_URL: `${server.url}/releases/latest/download`,
      };

      let result = await runCommand(
        'bash',
        [scriptPath, 'stable'],
        env
      );
      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/latest/download/prefactor-linux-x64.tar.gz');
      expect(readFileSync(childLog, 'utf8')).toContain('--channel');

      requests.length = 0;
      result = await runCommand(
        'bash',
        [scriptPath, 'latest'],
        env
      );
      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/download/canary/prefactor-linux-x64.tar.gz');
      expect(readFileSync(childLog, 'utf8')).toContain('canary');

      requests.length = 0;
      result = await runCommand(
        'bash',
        [scriptPath, '0.0.4'],
        env
      );
      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/download/v0.0.4/prefactor-linux-x64.tar.gz');
      expect(readFileSync(childLog, 'utf8')).toContain('--version');
    } finally {
      await server.close();
    }
  });
});
