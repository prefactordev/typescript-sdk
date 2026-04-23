import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  doctorManagedBinary,
  INSTALL_STATE_FILENAME,
  installManagedBinary,
  type LifecycleCommandDeps,
  readInstallState,
  uninstallManagedBinary,
  updateManagedBinary,
} from '../src/install/installer.js';
import { detectPlatformInfo } from '../src/install/platform.js';
import {
  buildAssetName,
  buildReleaseSpec,
  normalizePinnedVersion,
} from '../src/install/release.js';

function createDeps(
  overrides: Partial<LifecycleCommandDeps> = {},
  homeDir?: string
): LifecycleCommandDeps {
  const env = {
    HOME: homeDir,
    PATH: '',
    ...overrides.env,
  } as NodeJS.ProcessEnv;

  return {
    env,
    stdout: overrides.stdout ?? console,
    fetchImpl: overrides.fetchImpl ?? fetch,
    now: overrides.now ?? (() => new Date('2026-04-15T00:00:00.000Z')),
    currentExecutablePath: overrides.currentExecutablePath ?? (() => process.execPath),
    detectPlatform:
      overrides.detectPlatform ??
      (() => ({
        platform: 'linux',
        arch: 'x64',
        libc: 'glibc',
        isRosetta: false,
      })),
    spawnProcess: overrides.spawnProcess ?? spawn,
  };
}

describe('install helpers', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-install-test-'));
  });

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('normalizePinnedVersion accepts bare and prefixed semver', () => {
    expect(normalizePinnedVersion('0.0.4')).toBe('v0.0.4');
    expect(normalizePinnedVersion('v0.0.4')).toBe('v0.0.4');
  });

  test('buildReleaseSpec returns stable, latest, and pinned URLs', () => {
    const platform = { platform: 'linux', arch: 'x64', libc: 'glibc' as const };

    expect(buildReleaseSpec(platform, undefined, undefined).assetUrl).toContain(
      '/releases/latest/download/prefactor-linux-x64.tar.gz'
    );
    expect(buildReleaseSpec(platform, 'latest', undefined).assetUrl).toContain(
      '/releases/download/canary/prefactor-linux-x64.tar.gz'
    );
    expect(buildReleaseSpec(platform, undefined, '0.0.4').assetUrl).toContain(
      '/releases/download/v0.0.4/prefactor-linux-x64.tar.gz'
    );
  });

  test('detectPlatformInfo detects musl and rosetta', () => {
    const musl = detectPlatformInfo({
      platform: 'linux',
      arch: 'x64',
      glibcVersionRuntime: undefined,
    });
    expect(musl.libc).toBe('musl');

    const rosetta = detectPlatformInfo({
      platform: 'darwin',
      arch: 'x64',
      env: { PREFACTOR_INSTALL_TEST_ROSETTA: '1' },
      execFileSync: mock(() => '1') as unknown as typeof import('node:child_process').execFileSync,
    });
    expect(rosetta.arch).toBe('arm64');
    expect(rosetta.isRosetta).toBeTrue();
  });

  test('install writes install state and prints PATH guidance', async () => {
    const fakeSource = join(tempRoot, 'prefactor');
    writeFileSync(fakeSource, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

    const logs: string[] = [];
    const deps = createDeps(
      {
        env: { HOME: tempRoot, PATH: '' },
        stdout: {
          log: (...args: unknown[]) => logs.push(args.join(' ')),
          error: () => {},
        },
        currentExecutablePath: () => fakeSource,
      },
      tempRoot
    );

    const state = await installManagedBinary({}, '0.0.4', deps);

    expect(state.binPath).toBe(join(tempRoot, '.prefactor', 'bin', 'prefactor'));
    expect(readFileSync(state.binPath, 'utf8')).toContain('exit 0');

    const saved = await readInstallState(join(tempRoot, '.prefactor'));
    expect(saved.state?.resolvedTag).toBe('v0.0.4');
    expect(saved.state?.channel).toBe('stable');
    expect(logs.join('\n')).toContain('export PATH=');
  });

  test('install reports when bin dir is already on PATH', async () => {
    const fakeSource = join(tempRoot, 'prefactor');
    writeFileSync(fakeSource, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const binDir = join(tempRoot, '.prefactor', 'bin');
    const logs: string[] = [];

    const deps = createDeps(
      {
        env: { HOME: tempRoot, PATH: binDir },
        stdout: {
          log: (...args: unknown[]) => logs.push(args.join(' ')),
          error: () => {},
        },
        currentExecutablePath: () => fakeSource,
      },
      tempRoot
    );

    await installManagedBinary({}, '0.0.4', deps);

    expect(logs.join('\n')).toContain('already on PATH');
  });

  test('uninstall removes managed binary but preserves prefactor.json', async () => {
    const fakeSource = join(tempRoot, 'prefactor');
    writeFileSync(fakeSource, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const configPath = join(tempRoot, '.prefactor', 'prefactor.json');
    await mkdir(join(tempRoot, '.prefactor'), { recursive: true });
    writeFileSync(
      configPath,
      '{"default":{"api_key":"x","base_url":"https://app.prefactorai.com"}}'
    );

    const deps = createDeps(
      {
        env: { HOME: tempRoot, PATH: '' },
        currentExecutablePath: () => fakeSource,
      },
      tempRoot
    );

    await installManagedBinary({}, '0.0.4', deps);
    await uninstallManagedBinary(deps);

    expect(() => readFileSync(configPath, 'utf8')).not.toThrow();
    const state = await readInstallState(join(tempRoot, '.prefactor'));
    expect(state.state).toBeNull();
  });

  test('doctor prints install metadata', async () => {
    const fakeSource = join(tempRoot, 'prefactor');
    writeFileSync(fakeSource, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const logs: string[] = [];
    const deps = createDeps(
      {
        env: { HOME: tempRoot, PATH: '' },
        stdout: {
          log: (...args: unknown[]) => logs.push(args.join(' ')),
          error: () => {},
        },
        currentExecutablePath: () => fakeSource,
      },
      tempRoot
    );

    await installManagedBinary({}, '0.0.4', deps);
    logs.length = 0;
    await doctorManagedBinary(deps);

    const output = logs.join('\n');
    expect(output).toContain('installState: present');
    expect(output).toContain('resolvedTag: v0.0.4');
    expect(output).toContain('platform: linux');
  });

  test('update downloads and runs the extracted installer on unix', async () => {
    const fakeSource = join(tempRoot, 'prefactor');
    writeFileSync(fakeSource, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const childLog = join(tempRoot, 'child-install.log');

    const deps = createDeps(
      {
        env: { HOME: tempRoot, PATH: '' },
        currentExecutablePath: () => fakeSource,
      },
      tempRoot
    );
    await installManagedBinary({}, '0.0.4', deps);

    const assetName = buildAssetName({ platform: 'linux', arch: 'x64', libc: 'glibc' });
    const archiveDir = join(tempRoot, 'archive-src');
    const archiveBinary = join(archiveDir, 'prefactor');
    await mkdir(archiveDir, { recursive: true });
    writeFileSync(
      archiveBinary,
      `#!/usr/bin/env bash\nprintf '%s\n' "$@" > "${childLog}"\nexit 0\n`,
      { mode: 0o755 }
    );
    const archivePath = join(tempRoot, assetName);
    Bun.spawnSync(['tar', '-czf', archivePath, '-C', archiveDir, 'prefactor']);
    const archiveBuffer = await readFile(archivePath);
    const sha = new Bun.CryptoHasher('sha256').update(archiveBuffer).digest('hex');
    const checksum = `${sha}  ${assetName}\n`;

    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/SHA256SUMS')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => checksum,
          url: 'https://github.com/prefactordev/typescript-sdk/releases/download/v0.0.4/SHA256SUMS',
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () =>
          archiveBuffer.buffer.slice(
            archiveBuffer.byteOffset,
            archiveBuffer.byteOffset + archiveBuffer.byteLength
          ),
        url: `https://github.com/prefactordev/typescript-sdk/releases/download/v0.0.4/${assetName}`,
      } as Response;
    });

    await updateManagedBinary(
      { version: '0.0.4' },
      '0.0.4',
      createDeps(
        {
          env: { HOME: tempRoot, PATH: '' },
          fetchImpl: fetchMock as unknown as typeof fetch,
          currentExecutablePath: () => fakeSource,
        },
        tempRoot
      )
    );

    expect(readFileSync(childLog, 'utf8')).not.toContain('--wait-for-pid');
  });

  test('readInstallState rejects invalid persisted channel values', async () => {
    const installRoot = join(tempRoot, '.prefactor');
    await mkdir(installRoot, { recursive: true });
    writeFileSync(
      join(installRoot, INSTALL_STATE_FILENAME),
      JSON.stringify({
        schemaVersion: 1,
        channel: 'bogus',
        requestedVersion: null,
        resolvedTag: 'v0.0.4',
        assetName: 'prefactor-linux-x64.tar.gz',
        platform: 'linux',
        arch: 'x64',
        libc: 'glibc',
        installRoot,
        binPath: join(installRoot, 'bin', 'prefactor'),
        installedAt: '2026-04-15T00:00:00.000Z',
      })
    );

    const result = await readInstallState(installRoot);

    expect(result.state).toBeNull();
    expect(result.error).toContain('is invalid');
  });

  test('update honors explicit channel after a pinned install', async () => {
    const fakeSource = join(tempRoot, 'prefactor');
    writeFileSync(fakeSource, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const childLog = join(tempRoot, 'child-install.log');

    await installManagedBinary(
      { version: '0.0.4' },
      '0.0.4',
      createDeps(
        {
          env: { HOME: tempRoot, PATH: '' },
          currentExecutablePath: () => fakeSource,
        },
        tempRoot
      )
    );

    const assetName = buildAssetName({ platform: 'linux', arch: 'x64', libc: 'glibc' });
    const archiveDir = join(tempRoot, 'archive-latest');
    await mkdir(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, 'prefactor'),
      `#!/usr/bin/env bash\nprintf '%s\n' "$@" > "${childLog}"\nexit 0\n`,
      { mode: 0o755 }
    );
    const archivePath = join(tempRoot, assetName);
    Bun.spawnSync(['tar', '-czf', archivePath, '-C', archiveDir, 'prefactor']);
    const archiveBuffer = await readFile(archivePath);
    const checksum = `${new Bun.CryptoHasher('sha256').update(archiveBuffer).digest('hex')}  ${assetName}\n`;
    const requests: string[] = [];

    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);

      if (url.endsWith('/SHA256SUMS')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => checksum,
          url: 'https://github.com/prefactordev/typescript-sdk/releases/download/canary/SHA256SUMS',
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () =>
          archiveBuffer.buffer.slice(
            archiveBuffer.byteOffset,
            archiveBuffer.byteOffset + archiveBuffer.byteLength
          ),
        url: `https://github.com/prefactordev/typescript-sdk/releases/download/canary/${assetName}`,
      } as Response;
    });

    await updateManagedBinary(
      { channel: 'latest' },
      '0.0.4',
      createDeps(
        {
          env: { HOME: tempRoot, PATH: '' },
          fetchImpl: fetchMock as unknown as typeof fetch,
          currentExecutablePath: () => fakeSource,
        },
        tempRoot
      )
    );

    expect(requests).toContain(
      `https://github.com/prefactordev/typescript-sdk/releases/download/canary/${assetName}`
    );
    expect(readFileSync(childLog, 'utf8')).toContain('--channel');
    expect(readFileSync(childLog, 'utf8')).toContain('latest');
    expect(readFileSync(childLog, 'utf8')).not.toContain('--version');
  });

  test('update verifies stable downloads against the resolved release tag checksum', async () => {
    const fakeSource = join(tempRoot, 'prefactor');
    writeFileSync(fakeSource, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const childLog = join(tempRoot, 'child-stable.log');

    await installManagedBinary(
      {},
      '0.0.4',
      createDeps(
        {
          env: { HOME: tempRoot, PATH: '' },
          currentExecutablePath: () => fakeSource,
        },
        tempRoot
      )
    );

    const assetName = buildAssetName({ platform: 'linux', arch: 'x64', libc: 'glibc' });
    const archiveDir = join(tempRoot, 'archive-stable');
    await mkdir(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, 'prefactor'),
      `#!/usr/bin/env bash\nprintf '%s\n' "$@" > "${childLog}"\nexit 0\n`,
      { mode: 0o755 }
    );
    const archivePath = join(tempRoot, assetName);
    Bun.spawnSync(['tar', '-czf', archivePath, '-C', archiveDir, 'prefactor']);
    const archiveBuffer = await readFile(archivePath);
    const checksum = `${new Bun.CryptoHasher('sha256').update(archiveBuffer).digest('hex')}  ${assetName}\n`;
    const resolvedTag = 'v0.0.5';
    const requests: string[] = [];

    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);

      if (
        url ===
        `https://github.com/prefactordev/typescript-sdk/releases/latest/download/${assetName}`
      ) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () =>
            archiveBuffer.buffer.slice(
              archiveBuffer.byteOffset,
              archiveBuffer.byteOffset + archiveBuffer.byteLength
            ),
          url: `https://github.com/prefactordev/typescript-sdk/releases/download/${resolvedTag}/${assetName}`,
        } as Response;
      }

      if (
        url ===
        `https://github.com/prefactordev/typescript-sdk/releases/download/${resolvedTag}/SHA256SUMS`
      ) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => checksum,
          url,
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response;
    });

    await updateManagedBinary(
      {},
      '0.0.4',
      createDeps(
        {
          env: { HOME: tempRoot, PATH: '' },
          fetchImpl: fetchMock as unknown as typeof fetch,
          currentExecutablePath: () => fakeSource,
        },
        tempRoot
      )
    );

    expect(requests).toContain(
      `https://github.com/prefactordev/typescript-sdk/releases/download/${resolvedTag}/SHA256SUMS`
    );
    expect(requests).not.toContain(
      'https://github.com/prefactordev/typescript-sdk/releases/latest/download/SHA256SUMS'
    );
    expect(readFileSync(childLog, 'utf8')).toContain(resolvedTag);
  });
});
