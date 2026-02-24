import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface Profile {
  api_key: string;
  base_url: string;
}

export type Profiles = Record<string, Profile>;

export const DEFAULT_PROFILE_NAME = 'default';
export const DEFAULT_BASE_URL = 'https://api.prefactor.ai';

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
  const cwdPath = resolve(process.cwd(), 'prefactor.json');
  if (await pathExists(cwdPath)) {
    return cwdPath;
  }

  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    return cwdPath;
  }

  const homePath = resolve(home, '.prefactor', 'prefactor.json');
  if (await pathExists(homePath)) {
    return homePath;
  }

  return cwdPath;
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
  const cwd = process.cwd();
  const localConfigPath = resolve(cwd, 'prefactor.json');

  if (!(await isSamePath(configPath, localConfigPath))) {
    return;
  }

  if (!(await pathExists(resolve(cwd, '.git')))) {
    return;
  }

  const gitignorePath = resolve(cwd, '.gitignore');
  const entry = 'prefactor.json';

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

async function isSamePath(left: string, right: string): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return resolve(left) === resolve(right);
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
