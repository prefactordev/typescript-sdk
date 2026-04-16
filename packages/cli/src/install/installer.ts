import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { detectPlatformInfo, type PlatformInfo } from './platform.js';
import {
  buildReleaseSpec,
  type InstallChannel,
  parseResolvedTagFromUrl,
  type ReleaseSpec,
} from './release.js';

export interface InstallState {
  schemaVersion: 1;
  channel: InstallChannel;
  requestedVersion: string | null;
  resolvedTag: string;
  assetName: string;
  platform: PlatformInfo['platform'];
  arch: PlatformInfo['arch'];
  libc: PlatformInfo['libc'];
  installRoot: string;
  binPath: string;
  installedAt: string;
}

export interface InstallCommandOptions {
  channel?: 'stable' | 'latest';
  version?: string;
  sourceBinary?: string;
  resolvedTag?: string;
  assetName?: string;
  waitForPid?: number;
}

export interface UpdateCommandOptions {
  channel?: 'stable' | 'latest';
  version?: string;
}

export interface LifecycleCommandDeps {
  env: NodeJS.ProcessEnv;
  stdout: Pick<Console, 'log' | 'error'>;
  fetchImpl: typeof fetch;
  now: () => Date;
  currentExecutablePath: () => string;
  detectPlatform: () => PlatformInfo;
  spawnProcess: typeof spawn;
}

export const INSTALL_STATE_FILENAME = 'install.json';

const WINDOWS_INSTALL_RETRY_ATTEMPTS = 100;
const WINDOWS_INSTALL_RETRY_DELAY_MS = 250;

export function createDefaultLifecycleDeps(): LifecycleCommandDeps {
  return {
    env: process.env,
    stdout: console,
    fetchImpl: fetch,
    now: () => new Date(),
    currentExecutablePath: () => process.env.PREFACTOR_CLI_SELF_PATH || process.execPath,
    detectPlatform: () => detectPlatformInfo(),
    spawnProcess: spawn,
  };
}

export function resolveInstallRoot(env: NodeJS.ProcessEnv): string {
  const home = env.HOME || env.USERPROFILE;
  if (!home) {
    throw new Error('Unable to determine the user home directory for installation.');
  }

  return resolve(home, '.prefactor');
}

export function resolveManagedBinaryPath(
  installRoot: string,
  platform: PlatformInfo['platform']
): string {
  return join(installRoot, 'bin', platform === 'windows' ? 'prefactor.exe' : 'prefactor');
}

function resolveInstallStatePath(installRoot: string): string {
  return join(installRoot, INSTALL_STATE_FILENAME);
}

function normalizePathForComparison(pathValue: string, platform: PlatformInfo['platform']): string {
  const resolvedPath = resolve(pathValue);
  return platform === 'windows' ? resolvedPath.toLowerCase() : resolvedPath;
}

export function isDirectoryOnPath(
  candidateDir: string,
  env: NodeJS.ProcessEnv,
  platform: PlatformInfo['platform']
): boolean {
  const pathValue = env.PATH ?? '';
  const normalizedCandidate = normalizePathForComparison(candidateDir, platform);

  return pathValue
    .split(delimiter)
    .filter((entry) => entry.length > 0)
    .some((entry) => normalizePathForComparison(entry, platform) === normalizedCandidate);
}

function buildPathInstruction(binDir: string, platform: PlatformInfo['platform']): string {
  if (platform === 'windows') {
    return `Add ${binDir} to your PATH, then open a new terminal.`;
  }

  return `Add this line to your shell profile: export PATH="${binDir}:$PATH"`;
}

async function fileExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

async function ensureExecutablePermissions(pathValue: string, platform: PlatformInfo['platform']) {
  if (platform !== 'windows') {
    await chmod(pathValue, 0o755);
  }
}

async function waitForPidToExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < WINDOWS_INSTALL_RETRY_ATTEMPTS; attempt += 1) {
    try {
      process.kill(pid, 0);
      await delay(WINDOWS_INSTALL_RETRY_DELAY_MS);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        return;
      }
      await delay(WINDOWS_INSTALL_RETRY_DELAY_MS);
    }
  }

  throw new Error(`Timed out waiting for process ${pid} to exit.`);
}

async function replaceManagedBinary(
  sourceBinary: string,
  targetBinary: string,
  platform: PlatformInfo['platform']
): Promise<void> {
  const binDir = dirname(targetBinary);
  await mkdir(binDir, { recursive: true });

  const stagedBinary = `${targetBinary}.tmp-${process.pid}`;
  await rm(stagedBinary, { force: true });
  await copyFile(sourceBinary, stagedBinary);
  await ensureExecutablePermissions(stagedBinary, platform);

  if (platform !== 'windows') {
    await rename(stagedBinary, targetBinary);
    return;
  }

  for (let attempt = 0; attempt < WINDOWS_INSTALL_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await unlink(targetBinary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
      await rename(stagedBinary, targetBinary);
      return;
    } catch (error) {
      if (attempt === WINDOWS_INSTALL_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await delay(WINDOWS_INSTALL_RETRY_DELAY_MS);
    }
  }
}

function buildInstallState(
  installRoot: string,
  managedBinaryPath: string,
  platform: PlatformInfo,
  assetName: string,
  channel: InstallChannel,
  requestedVersion: string | null,
  resolvedTag: string,
  now: Date
): InstallState {
  return {
    schemaVersion: 1,
    channel,
    requestedVersion,
    resolvedTag,
    assetName,
    platform: platform.platform,
    arch: platform.arch,
    libc: platform.libc,
    installRoot,
    binPath: managedBinaryPath,
    installedAt: now.toISOString(),
  };
}

async function writeInstallState(installRoot: string, state: InstallState): Promise<void> {
  await mkdir(installRoot, { recursive: true });
  await writeFile(resolveInstallStatePath(installRoot), JSON.stringify(state, null, 2));
}

export async function readInstallState(
  installRoot: string
): Promise<{ state: InstallState | null; error: string | null }> {
  const statePath = resolveInstallStatePath(installRoot);
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<InstallState>;

    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.channel !== 'string' ||
      typeof parsed.resolvedTag !== 'string' ||
      typeof parsed.assetName !== 'string' ||
      typeof parsed.platform !== 'string' ||
      typeof parsed.arch !== 'string' ||
      typeof parsed.installRoot !== 'string' ||
      typeof parsed.binPath !== 'string' ||
      typeof parsed.installedAt !== 'string'
    ) {
      return { state: null, error: `Install state at ${statePath} is invalid.` };
    }

    return {
      state: parsed as InstallState,
      error: null,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { state: null, error: `Install state not found at ${statePath}.` };
    }
    return { state: null, error: `Unable to read install state at ${statePath}.` };
  }
}

function createReleaseBaseUrls(env: NodeJS.ProcessEnv): {
  baseUrl: string;
  latestBaseUrl: string;
} {
  const baseUrl =
    env.PREFACTOR_RELEASE_BASE_URL ??
    'https://github.com/prefactordev/typescript-sdk/releases/download';
  return {
    baseUrl,
    latestBaseUrl:
      env.PREFACTOR_RELEASE_LATEST_BASE_URL ??
      `${baseUrl.replace(/\/download$/, '')}/latest/download`,
  };
}

function parseSha256Manifest(contents: string, assetName: string): string {
  for (const line of contents.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match && match[2] === assetName) {
      return match[1].toLowerCase();
    }
  }

  throw new Error(`No checksum entry found for ${assetName}.`);
}

async function downloadToFile(
  url: string,
  destination: string,
  fetchImpl: typeof fetch
): Promise<{ finalUrl: string }> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Download failed for ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(destination, Buffer.from(arrayBuffer));

  return { finalUrl: response.url || url };
}

async function sha256File(pathValue: string): Promise<string> {
  const contents = await readFile(pathValue);
  return createHash('sha256').update(contents).digest('hex');
}

async function verifyDownloadedAsset(
  assetPath: string,
  assetName: string,
  checksumUrl: string,
  fetchImpl: typeof fetch
): Promise<{ resolvedTag: string | null }> {
  const response = await fetchImpl(checksumUrl);
  if (!response.ok) {
    throw new Error(
      `Checksum download failed for ${checksumUrl}: ${response.status} ${response.statusText}`
    );
  }

  const manifestText = await response.text();
  const expectedChecksum = parseSha256Manifest(manifestText, assetName);
  const actualChecksum = await sha256File(assetPath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Checksum mismatch for ${assetName}.`);
  }

  return {
    resolvedTag: parseResolvedTagFromUrl(response.url || checksumUrl),
  };
}

async function extractArchive(
  archivePath: string,
  destinationDir: string,
  platform: PlatformInfo['platform']
): Promise<string> {
  if (platform === 'windows') {
    const powershell = process.env.ComSpec ? 'powershell.exe' : 'powershell';
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(
        powershell,
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`,
        ],
        { stdio: 'ignore' }
      );
      child.on('exit', (code) => {
        if (code === 0) {
          resolvePromise();
          return;
        }
        reject(new Error(`Failed to extract ${basename(archivePath)}.`));
      });
      child.on('error', reject);
    });
    return join(destinationDir, 'prefactor.exe');
  }

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('tar', ['-xzf', archivePath, '-C', destinationDir], { stdio: 'ignore' });
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`Failed to extract ${basename(archivePath)}.`));
    });
    child.on('error', reject);
  });

  return join(destinationDir, 'prefactor');
}

function inferResolvedTagFromInstallRequest(
  channel: InstallChannel,
  requestedVersion: string | null,
  explicitResolvedTag: string | undefined,
  currentVersion: string
): string {
  if (explicitResolvedTag) {
    return explicitResolvedTag;
  }
  if (channel === 'latest') {
    return 'canary';
  }
  if (channel === 'pinned' && requestedVersion) {
    return requestedVersion;
  }
  return `v${currentVersion}`;
}

export async function installManagedBinary(
  options: InstallCommandOptions,
  version: string,
  deps: LifecycleCommandDeps = createDefaultLifecycleDeps()
): Promise<InstallState> {
  const platform = deps.detectPlatform();
  const installRoot = resolveInstallRoot(deps.env);
  const releaseUrls = createReleaseBaseUrls(deps.env);
  const releaseSpec = buildReleaseSpec(
    platform,
    options.channel,
    options.version,
    releaseUrls.baseUrl,
    releaseUrls.latestBaseUrl
  );
  const sourceBinary = resolve(options.sourceBinary ?? deps.currentExecutablePath());

  if (!(await fileExists(sourceBinary))) {
    throw new Error(`Install source binary not found at ${sourceBinary}.`);
  }

  if (options.waitForPid !== undefined) {
    await waitForPidToExit(options.waitForPid);
  }

  const managedBinaryPath = resolveManagedBinaryPath(installRoot, platform.platform);
  await replaceManagedBinary(sourceBinary, managedBinaryPath, platform.platform);

  const state = buildInstallState(
    installRoot,
    managedBinaryPath,
    platform,
    options.assetName ?? releaseSpec.assetName,
    releaseSpec.channel,
    releaseSpec.requestedVersion,
    inferResolvedTagFromInstallRequest(
      releaseSpec.channel,
      releaseSpec.requestedVersion,
      options.resolvedTag,
      version
    ),
    deps.now()
  );

  await writeInstallState(installRoot, state);

  deps.stdout.log(`Installed Prefactor CLI to ${managedBinaryPath}`);
  const binDir = dirname(managedBinaryPath);
  if (isDirectoryOnPath(binDir, deps.env, platform.platform)) {
    deps.stdout.log('The Prefactor bin directory is already on PATH.');
  } else {
    deps.stdout.log(buildPathInstruction(binDir, platform.platform));
  }

  return state;
}

function buildChildInstallArgs(
  childBinaryPath: string,
  spec: ReleaseSpec,
  resolvedTag: string,
  currentPid: number
): string[] {
  return [
    'install',
    '--source-binary',
    childBinaryPath,
    '--resolved-tag',
    resolvedTag,
    '--asset-name',
    spec.assetName,
    '--wait-for-pid',
    String(currentPid),
    ...(spec.channel === 'pinned' && spec.requestedVersion
      ? ['--version', spec.requestedVersion]
      : ['--channel', spec.channel]),
  ];
}

async function runChildInstaller(
  childBinaryPath: string,
  spec: ReleaseSpec,
  resolvedTag: string,
  deps: LifecycleCommandDeps,
  platform: PlatformInfo['platform']
): Promise<void> {
  const args = buildChildInstallArgs(childBinaryPath, spec, resolvedTag, process.pid);

  if (platform === 'windows') {
    await new Promise<void>((resolvePromise, reject) => {
      const child = deps.spawnProcess(childBinaryPath, args, {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', reject);
      child.unref();
      resolvePromise();
    });
    deps.stdout.log(
      'Update started. The installed binary will be replaced after this process exits.'
    );
    return;
  }

  await new Promise<void>((resolvePromise, reject) => {
    const child = deps.spawnProcess(childBinaryPath, args, {
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error('The downloaded installer failed.'));
    });
    child.on('error', reject);
  });
}

export async function updateManagedBinary(
  options: UpdateCommandOptions,
  _version: string,
  deps: LifecycleCommandDeps = createDefaultLifecycleDeps()
): Promise<void> {
  const platform = deps.detectPlatform();
  const installRoot = resolveInstallRoot(deps.env);
  const installState = await readInstallState(installRoot);
  if (installState.state === null) {
    throw new Error(installState.error ?? 'Prefactor CLI is not installed.');
  }

  const requestedChannel =
    options.version || options.channel
      ? options.channel
      : installState.state.channel === 'pinned'
        ? undefined
        : installState.state.channel;
  const requestedVersion =
    options.version ??
    (installState.state.channel === 'pinned'
      ? (installState.state.requestedVersion ?? undefined)
      : undefined);
  const releaseUrls = createReleaseBaseUrls(deps.env);
  const spec = buildReleaseSpec(
    platform,
    requestedChannel,
    requestedVersion,
    releaseUrls.baseUrl,
    releaseUrls.latestBaseUrl
  );

  const tempRoot = await mkdtemp(join(tmpdir(), 'prefactor-update-'));
  try {
    const archivePath = join(tempRoot, spec.assetName);
    const downloadResult = await downloadToFile(spec.assetUrl, archivePath, deps.fetchImpl);
    const checksumResult = await verifyDownloadedAsset(
      archivePath,
      spec.assetName,
      spec.checksumUrl,
      deps.fetchImpl
    );
    const resolvedTag =
      checksumResult.resolvedTag ??
      parseResolvedTagFromUrl(downloadResult.finalUrl) ??
      spec.resolvedTag;

    const extractedDir = join(tempRoot, 'extracted');
    await mkdir(extractedDir, { recursive: true });
    const childBinaryPath = await extractArchive(archivePath, extractedDir, platform.platform);

    await runChildInstaller(childBinaryPath, spec, resolvedTag, deps, platform.platform);

    if (platform.platform !== 'windows') {
      deps.stdout.log(`Updated Prefactor CLI to ${resolvedTag}.`);
    }
  } finally {
    if (platform.platform !== 'windows') {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

export async function uninstallManagedBinary(
  deps: LifecycleCommandDeps = createDefaultLifecycleDeps()
): Promise<void> {
  const platform = deps.detectPlatform();
  const installRoot = resolveInstallRoot(deps.env);
  const statePath = resolveInstallStatePath(installRoot);
  const managedBinaryPath = resolveManagedBinaryPath(installRoot, platform.platform);

  await rm(managedBinaryPath, { force: true });
  await rm(statePath, { force: true });

  const binDir = dirname(managedBinaryPath);
  try {
    const entries = await stat(binDir);
    if (entries.isDirectory()) {
      await rm(binDir, { recursive: false });
    }
  } catch {}

  try {
    const rootStat = await stat(installRoot);
    if (rootStat.isDirectory()) {
      await rm(installRoot, { recursive: false });
    }
  } catch {}

  deps.stdout.log(`Removed Prefactor CLI from ${managedBinaryPath}`);
}

export async function doctorManagedBinary(
  deps: LifecycleCommandDeps = createDefaultLifecycleDeps()
): Promise<void> {
  const platform = deps.detectPlatform();
  const installRoot = resolveInstallRoot(deps.env);
  const managedBinaryPath = resolveManagedBinaryPath(installRoot, platform.platform);
  const installState = await readInstallState(installRoot);
  const currentBinary = deps.currentExecutablePath();
  const binDir = dirname(managedBinaryPath);

  deps.stdout.log(`installRoot: ${installRoot}`);
  deps.stdout.log(`binPath: ${managedBinaryPath}`);
  deps.stdout.log(`currentExecutable: ${currentBinary}`);
  deps.stdout.log(
    `pathStatus: ${isDirectoryOnPath(binDir, deps.env, platform.platform) ? 'present' : 'missing'}`
  );
  deps.stdout.log(`platform: ${platform.platform}`);
  deps.stdout.log(`arch: ${platform.arch}`);
  deps.stdout.log(`libc: ${platform.libc ?? 'n/a'}`);
  deps.stdout.log(`rosetta: ${platform.isRosetta ? 'yes' : 'no'}`);

  if (installState.state === null) {
    deps.stdout.log(`installState: missing`);
    deps.stdout.log(`installStateError: ${installState.error ?? 'unknown'}`);
    return;
  }

  const binaryExists = await fileExists(installState.state.binPath);
  deps.stdout.log(`installState: present`);
  deps.stdout.log(`channel: ${installState.state.channel}`);
  deps.stdout.log(`requestedVersion: ${installState.state.requestedVersion ?? 'null'}`);
  deps.stdout.log(`resolvedTag: ${installState.state.resolvedTag}`);
  deps.stdout.log(`assetName: ${installState.state.assetName}`);
  deps.stdout.log(`installedAt: ${installState.state.installedAt}`);
  deps.stdout.log(`managedBinaryExists: ${binaryExists ? 'yes' : 'no'}`);
}
