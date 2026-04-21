import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export interface Profile {
  api_key: string;
  base_url: string;
}

export type Profiles = Record<string, Profile>;

export const DEFAULT_PROFILE_NAME = 'default';
export const DEFAULT_BASE_URL = 'https://app.prefactorai.com';
const CONFIG_FILENAME = 'prefactor.json';

export class ProfileManager {
  private constructor(
    private readonly configPath: string,
    private profiles: Profiles
  ) {}

  static async create(configPath?: string): Promise<ProfileManager> {
    const resolvedPath = configPath ?? (await findConfigPath());
    const profiles = await loadProfiles(resolvedPath);
    return new ProfileManager(resolvedPath, profiles);
  }

  getProfileEntries(): Array<[string, Profile]> {
    return Object.entries(this.profiles);
  }

  getProfiles(): string[] {
    return Object.keys(this.profiles);
  }

  getProfile(name: string): Profile | null {
    return this.profiles[name] ?? null;
  }

  async addProfile(
    name: string,
    apiKey: string,
    baseUrl: string = DEFAULT_BASE_URL
  ): Promise<void> {
    this.profiles[name] = {
      api_key: apiKey,
      base_url: baseUrl,
    };

    await this.save();
  }

  async removeProfile(name: string): Promise<boolean> {
    if (!this.profiles[name]) {
      return false;
    }

    delete this.profiles[name];
    await this.save();
    return true;
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(this.profiles, null, 2), { mode: 0o600 });
    await ensureLocalGitignoreEntry(this.configPath);
  }
}

async function findConfigPath(): Promise<string> {
  const directoryRoot = await findDirectoryRoot(process.cwd());
  const directoryRootConfigPath = resolve(directoryRoot, CONFIG_FILENAME);

  if (await pathExists(directoryRootConfigPath)) {
    return directoryRootConfigPath;
  }

  return resolveExecutableConfigPath();
}

async function findDirectoryRoot(startDir: string): Promise<string> {
  let currentDir = resolve(startDir);

  while (true) {
    if (await pathExists(resolve(currentDir, '.git'))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return resolve(startDir);
    }

    currentDir = parentDir;
  }
}

function resolveExecutableConfigPath(): string {
  const executablePath = resolve(process.env.PREFACTOR_CLI_SELF_PATH || process.execPath);
  const executableDir = dirname(executablePath);
  const executableRoot = basename(executableDir) === 'bin' ? dirname(executableDir) : executableDir;

  return resolve(executableRoot, CONFIG_FILENAME);
}

async function loadProfiles(configPath: string): Promise<Profiles> {
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parseProfiles(parsed);
  } catch {
    return {};
  }
}

async function ensureLocalGitignoreEntry(configPath: string): Promise<void> {
  if (basename(configPath) !== CONFIG_FILENAME) {
    return;
  }

  const configDir = dirname(configPath);

  if (!(await pathExists(resolve(configDir, '.git')))) {
    return;
  }

  const gitignorePath = resolve(configDir, '.gitignore');
  const entry = CONFIG_FILENAME;

  let contents = '';
  try {
    contents = await readFile(gitignorePath, 'utf8');
  } catch {
    await writeFile(gitignorePath, `${entry}\n`);
    return;
  }

  const hasEntry = contents
    .split(/\r?\n/)
    .some((line) => line.trim() === entry || line.trim() === `/${entry}`);

  if (hasEntry) {
    return;
  }

  const separator = contents.endsWith('\n') || contents.length === 0 ? '' : '\n';
  await writeFile(gitignorePath, `${contents}${separator}${entry}\n`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseProfiles(value: unknown): Profiles {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const profiles: Profiles = {};
  for (const [name, entry] of Object.entries(value)) {
    const profile = parseProfile(entry);
    if (profile) {
      profiles[name] = profile;
    }
  }

  return profiles;
}

function parseProfile(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as { api_key?: unknown; base_url?: unknown };
  if (typeof entry.api_key !== 'string' || typeof entry.base_url !== 'string') {
    return null;
  }

  return {
    api_key: entry.api_key,
    base_url: entry.base_url,
  };
}

export function resolveCurrentProfileName(explicitProfile?: string): string {
  return explicitProfile || process.env.PREFACTOR_PROFILE || DEFAULT_PROFILE_NAME;
}
