import { execFileSync } from 'node:child_process';

export type InstallPlatform = 'darwin' | 'linux' | 'windows';
export type InstallArch = 'x64' | 'arm64';
export type InstallLibc = 'glibc' | 'musl' | null;

export interface PlatformInfo {
  platform: InstallPlatform;
  arch: InstallArch;
  libc: InstallLibc;
  isRosetta: boolean;
}

export interface PlatformDetectionDeps {
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  execFileSync?: typeof execFileSync;
  glibcVersionRuntime?: string | undefined;
}

function normalizePlatform(platform: NodeJS.Platform): InstallPlatform {
  if (platform === 'darwin') {
    return 'darwin';
  }
  if (platform === 'linux') {
    return 'linux';
  }
  if (platform === 'win32') {
    return 'windows';
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

function normalizeArch(arch: string): InstallArch {
  if (arch === 'arm64') {
    return 'arm64';
  }
  if (arch === 'x64') {
    return 'x64';
  }
  throw new Error(`Unsupported architecture: ${arch}`);
}

function detectMusl(
  platform: InstallPlatform,
  glibcVersionRuntime: string | undefined
): InstallLibc {
  if (platform !== 'linux') {
    return null;
  }

  return glibcVersionRuntime ? 'glibc' : 'musl';
}

function detectRosetta(
  platform: InstallPlatform,
  arch: InstallArch,
  deps: Required<Pick<PlatformDetectionDeps, 'execFileSync' | 'env'>>
): boolean {
  if (platform !== 'darwin' || arch !== 'x64') {
    return false;
  }

  if (deps.env.PREFACTOR_INSTALL_TEST_ROSETTA === '1') {
    return true;
  }
  if (deps.env.PREFACTOR_INSTALL_TEST_ROSETTA === '0') {
    return false;
  }

  try {
    const translated = deps
      .execFileSync('sysctl', ['-in', 'sysctl.proc_translated'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .trim();
    return translated === '1';
  } catch {
    return false;
  }
}

export function detectPlatformInfo(deps: PlatformDetectionDeps = {}): PlatformInfo {
  const exec = deps.execFileSync ?? execFileSync;
  const env = deps.env ?? process.env;
  const platform = normalizePlatform(deps.platform ?? process.platform);
  const runtimeArch = normalizeArch(deps.arch ?? process.arch);
  const isRosetta = detectRosetta(platform, runtimeArch, { execFileSync: exec, env });
  const arch = platform === 'darwin' && isRosetta ? 'arm64' : runtimeArch;
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string | undefined } }
    | undefined;
  const reportHeader = report?.header;
  const glibcVersionRuntime = Object.hasOwn(deps, 'glibcVersionRuntime')
    ? deps.glibcVersionRuntime
    : reportHeader?.glibcVersionRuntime;

  return {
    platform,
    arch,
    libc: detectMusl(platform, glibcVersionRuntime),
    isRosetta,
  };
}
