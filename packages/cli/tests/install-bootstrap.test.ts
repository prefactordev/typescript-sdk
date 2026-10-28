import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex, withServer } from './install-test-helpers';

const scriptPath = join(process.cwd(), 'scripts', 'install.sh');

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
    const result = spawnSync('bash', [scriptPath, '--help'], {
      encoding: 'utf8',
    });

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
      const result = await runCommand('bash', [scriptPath], {
        ...process.env,
        PREFACTOR_INSTALL_TEST_UNAME_S: 'Linux',
        PREFACTOR_INSTALL_TEST_UNAME_M: 'x86_64',
        PREFACTOR_INSTALL_TEST_LIBC: 'glibc',
        PREFACTOR_RELEASE_BASE_URL: `${server.url}/releases/download`,
        PREFACTOR_RELEASE_LATEST_BASE_URL: `${server.url}/releases/latest/download`,
      });

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
        HOME: tempRoot,
        PREFACTOR_INSTALL_TEST_UNAME_S: 'Linux',
        PREFACTOR_INSTALL_TEST_UNAME_M: 'x86_64',
        PREFACTOR_INSTALL_TEST_LIBC: 'glibc',
        PREFACTOR_RELEASE_BASE_URL: `${server.url}/releases/download`,
        PREFACTOR_RELEASE_LATEST_BASE_URL: `${server.url}/releases/latest/download`,
      };

      let result = await runCommand('bash', [scriptPath, 'stable'], env);
      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/latest/download/prefactor-linux-x64.tar.gz');
      expect(readFileSync(childLog, 'utf8')).toContain('--channel');

      requests.length = 0;
      result = await runCommand('bash', [scriptPath, 'latest'], env);
      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/download/canary/prefactor-linux-x64.tar.gz');
      expect(readFileSync(childLog, 'utf8')).toContain('canary');

      requests.length = 0;
      result = await runCommand('bash', [scriptPath, '0.0.4'], env);
      expect(result.code).toBe(0);
      expect(requests).toContain('/releases/download/v0.0.4/prefactor-linux-x64.tar.gz');
      expect(readFileSync(childLog, 'utf8')).toContain('--version');
    } finally {
      await server.close();
    }
  });

  describe('PATH setup', () => {
    const exportLine = 'export PATH="$HOME/.prefactor/bin:$PATH"';
    let localBin = '';
    let pathValue = '';

    beforeEach(async () => {
      localBin = join(tempRoot, '.local', 'bin');
      await mkdir(localBin, { recursive: true });
      pathValue = `${localBin}:/usr/bin:/bin`;
    });

    // Serves a release whose binary copies itself into ~/.prefactor/bin on
    // `install`, like the real installer, and prints prefactor-ok otherwise.
    async function runInstall(options: {
      shell: string;
      unameS?: 'Linux' | 'Darwin';
    }): Promise<{ code: number | null; stdout: string; stderr: string }> {
      const unameS = options.unameS ?? 'Linux';
      const assetName =
        unameS === 'Darwin' ? 'prefactor-darwin-arm64.tar.gz' : 'prefactor-linux-x64.tar.gz';
      const archiveDir = join(tempRoot, 'archive');
      await mkdir(archiveDir, { recursive: true });
      writeFileSync(
        join(archiveDir, 'prefactor'),
        `#!/bin/bash
if [ "\${1:-}" = "install" ]; then
  mkdir -p "$HOME/.prefactor/bin"
  cp "$0" "$HOME/.prefactor/bin/prefactor"
  chmod +x "$HOME/.prefactor/bin/prefactor"
  exit 0
fi
printf '%s\n' prefactor-ok
`,
        { mode: 0o755 }
      );
      const archivePath = join(tempRoot, assetName);
      spawnSync('tar', ['-czf', archivePath, '-C', archiveDir, 'prefactor']);
      const archiveBuffer = Buffer.from(readFileSync(archivePath));
      const checksum = `${sha256Hex(archiveBuffer)}  ${assetName}\n`;
      const server = await withServer((req, res) => {
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
        return await runCommand('bash', [scriptPath], {
          HOME: tempRoot,
          PATH: pathValue,
          SHELL: options.shell,
          PREFACTOR_INSTALL_TEST_UNAME_S: unameS,
          PREFACTOR_INSTALL_TEST_UNAME_M: unameS === 'Darwin' ? 'arm64' : 'x86_64',
          PREFACTOR_INSTALL_TEST_LIBC: 'glibc',
          PREFACTOR_RELEASE_BASE_URL: `${server.url}/releases/download`,
          PREFACTOR_RELEASE_LATEST_BASE_URL: `${server.url}/releases/latest/download`,
        });
      } finally {
        await server.close();
      }
    }

    test('prefactor runs after install.sh without a new terminal', async () => {
      const result = await runInstall({ shell: '/bin/zsh' });
      expect(result.code).toBe(0);
      expect(readFileSync(join(tempRoot, '.zshrc'), 'utf8')).toContain(exportLine);
      expect(result.stdout).toContain(
        `Added ${tempRoot}/.prefactor/bin to PATH in ${tempRoot}/.zshrc`
      );
      expect(result.stdout).toContain(`Linked ${localBin}/prefactor`);

      const ran = spawnSync(join(localBin, 'prefactor'), [], {
        encoding: 'utf8',
        env: { HOME: tempRoot, PATH: pathValue },
      });
      expect(ran.status).toBe(0);
      expect(ran.stdout.trim()).toBe('prefactor-ok');
    });

    test.each([
      { unameS: 'Linux', shell: '/bin/bash', existing: [], expected: '.bashrc' },
      { unameS: 'Linux', shell: '/bin/sh', existing: [], expected: '.profile' },
      { unameS: 'Darwin', shell: '/bin/bash', existing: [], expected: '.bash_profile' },
      { unameS: 'Darwin', shell: '/bin/bash', existing: ['.profile'], expected: '.profile' },
      {
        unameS: 'Darwin',
        shell: '/bin/bash',
        existing: ['.bash_login', '.profile'],
        expected: '.bash_login',
      },
    ] as const)('$unameS $shell with $existing writes the export to $expected', async ({
      unameS,
      shell,
      existing,
      expected,
    }) => {
      for (const name of existing) {
        writeFileSync(join(tempRoot, name), '# existing\n');
      }

      const result = await runInstall({ shell, unameS });
      expect(result.code).toBe(0);
      expect(readFileSync(join(tempRoot, expected), 'utf8')).toContain(exportLine);
      for (const name of ['.bashrc', '.bash_profile', '.bash_login', '.profile']) {
        if (name !== expected && !(existing as readonly string[]).includes(name)) {
          expect(existsSync(join(tempRoot, name))).toBe(false);
        }
      }
    });

    test('does not add a second export when the startup file already references the bin dir', async () => {
      const zshrc = join(tempRoot, '.zshrc');
      writeFileSync(zshrc, 'export PATH=~/.prefactor/bin:$PATH\n');

      expect((await runInstall({ shell: '/bin/zsh' })).code).toBe(0);
      expect((await runInstall({ shell: '/bin/zsh' })).code).toBe(0);
      expect(readFileSync(zshrc, 'utf8')).toBe('export PATH=~/.prefactor/bin:$PATH\n');
    });

    test('leaves an existing prefactor symlink to another install untouched', async () => {
      const otherPrefactor = join(tempRoot, 'other', 'prefactor');
      await mkdir(join(tempRoot, 'other'), { recursive: true });
      writeFileSync(otherPrefactor, '#!/bin/sh\n', { mode: 0o755 });
      symlinkSync(otherPrefactor, join(localBin, 'prefactor'));

      const result = await runInstall({ shell: '/bin/zsh' });
      expect(result.code).toBe(0);
      expect(readlinkSync(join(localBin, 'prefactor'))).toBe(otherPrefactor);
    });

    test('leaves an existing prefactor file untouched', async () => {
      writeFileSync(join(localBin, 'prefactor'), 'existing\n', { mode: 0o755 });

      const result = await runInstall({ shell: '/bin/zsh' });
      expect(result.code).toBe(0);
      expect(readFileSync(join(localBin, 'prefactor'), 'utf8')).toBe('existing\n');
    });

    test('re-links a symlink that already points at the managed binary', async () => {
      expect((await runInstall({ shell: '/bin/zsh' })).code).toBe(0);
      const result = await runInstall({ shell: '/bin/zsh' });
      expect(result.code).toBe(0);
      expect(readlinkSync(join(localBin, 'prefactor'))).toBe(
        join(tempRoot, '.prefactor', 'bin', 'prefactor')
      );
    });

    test('warns and still succeeds when the startup file is not writable', async () => {
      const zshrc = join(tempRoot, '.zshrc');
      writeFileSync(zshrc, '# managed elsewhere\n');
      chmodSync(zshrc, 0o444);

      const result = await runInstall({ shell: '/bin/zsh' });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`Warning: could not update ${zshrc}`);
      expect(readFileSync(zshrc, 'utf8')).toBe('# managed elsewhere\n');
    });
  });
});
