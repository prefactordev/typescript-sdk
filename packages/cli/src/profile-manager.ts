import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface Profile {
  api_key: string;
  base_url: string;
}

export type Profiles = Record<string, Profile>;

export const DEFAULT_PROFILE_NAME = 'default';
export const DEFAULT_BASE_URL = 'https://api.prefactor.ai';

export class ProfileManager {
  private readonly configPath: string;
  private profiles: Profiles = {};

  constructor(configPath?: string) {
    this.configPath = configPath ?? this.findConfigPath();
    this.load();
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

  addProfile(name: string, apiKey: string, baseUrl: string = DEFAULT_BASE_URL): void {
    this.profiles[name] = {
      api_key: apiKey,
      base_url: baseUrl,
    };
    this.save();
  }

  removeProfile(name: string): boolean {
    if (!this.profiles[name]) {
      return false;
    }

    delete this.profiles[name];
    this.save();
    return true;
  }

  private findConfigPath(): string {
    const cwdPath = resolve(process.cwd(), 'prefactor.json');

    if (existsSync(cwdPath)) {
      return cwdPath;
    }

    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
      const homePath = resolve(home, '.prefactor', 'prefactor.json');
      if (existsSync(homePath)) {
        return homePath;
      }
    }

    return cwdPath;
  }

  private load(): void {
    if (!existsSync(this.configPath)) {
      return;
    }

    try {
      const raw = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this.profiles = parseProfiles(parsed);
    } catch {
      this.profiles = {};
    }
  }

  private save(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.configPath, JSON.stringify(this.profiles, null, 2));
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
