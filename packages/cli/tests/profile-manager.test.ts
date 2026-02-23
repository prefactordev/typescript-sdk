import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileManager } from '../src/profile-manager.js';

describe('ProfileManager', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-cli-test-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('prefers ./prefactor.json over $HOME fallback', async () => {
    const cwd = join(tempRoot, 'cwd');
    const home = join(tempRoot, 'home');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(home, '.prefactor'), { recursive: true });

    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ local: { api_key: 'local-key', base_url: 'https://local.example' } })
    );
    writeFileSync(
      join(home, '.prefactor', 'prefactor.json'),
      JSON.stringify({ home: { api_key: 'home-key', base_url: 'https://home.example' } })
    );

    process.chdir(cwd);
    process.env.HOME = home;

    const manager = await ProfileManager.create();
    expect(manager.getProfile('local')).not.toBeNull();
    expect(manager.getProfile('home')).toBeNull();
  });

  test('falls back to $HOME/.prefactor/prefactor.json when local file is absent', async () => {
    const cwd = join(tempRoot, 'cwd');
    const home = join(tempRoot, 'home');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(home, '.prefactor'), { recursive: true });

    writeFileSync(
      join(home, '.prefactor', 'prefactor.json'),
      JSON.stringify({ home: { api_key: 'home-key', base_url: 'https://home.example' } })
    );

    process.chdir(cwd);
    process.env.HOME = home;

    const manager = await ProfileManager.create();
    expect(manager.getProfile('home')).not.toBeNull();
  });

  test('uses default base URL when omitted on add', async () => {
    const configPath = join(tempRoot, 'prefactor.json');
    const manager = await ProfileManager.create(configPath);

    await manager.addProfile('demo', 'token-value');

    expect(manager.getProfile('demo')).toEqual({
      api_key: 'token-value',
      base_url: 'https://api.prefactor.ai',
    });
  });

  test('ignores malformed profile entries when loading config', async () => {
    const configPath = join(tempRoot, 'prefactor.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        valid: { api_key: 'valid-key', base_url: 'https://valid.example' },
        nullEntry: null,
        missingBaseUrl: { api_key: 'key-only' },
        wrongTypes: { api_key: 123, base_url: true },
        stringEntry: 'bad',
      })
    );

    const manager = await ProfileManager.create(configPath);

    expect(manager.getProfile('valid')).toEqual({
      api_key: 'valid-key',
      base_url: 'https://valid.example',
    });
    expect(manager.getProfile('nullEntry')).toBeNull();
    expect(manager.getProfile('missingBaseUrl')).toBeNull();
    expect(manager.getProfile('wrongTypes')).toBeNull();
    expect(manager.getProfile('stringEntry')).toBeNull();
  });

  test('adds prefactor.json to local .gitignore when creating local profile file', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(cwd, '.git'), { recursive: true });
    process.chdir(cwd);

    const manager = await ProfileManager.create(join(cwd, 'prefactor.json'));
    await manager.addProfile('default', 'token');

    const gitignore = readFileSync(join(cwd, '.gitignore'), 'utf8');
    expect(gitignore).toContain('prefactor.json');
  });

  test('does not duplicate prefactor.json in local .gitignore', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(cwd, '.git'), { recursive: true });
    process.chdir(cwd);

    writeFileSync(join(cwd, '.gitignore'), 'node_modules/\nprefactor.json\n');

    const manager = await ProfileManager.create(join(cwd, 'prefactor.json'));
    await manager.addProfile('default', 'token');

    const gitignore = readFileSync(join(cwd, '.gitignore'), 'utf8');
    const matches = gitignore.split('\n').filter((line) => line.trim() === 'prefactor.json');
    expect(matches).toHaveLength(1);
  });

  test('skips .gitignore updates when not in a git repository', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const manager = await ProfileManager.create(join(cwd, 'prefactor.json'));
    await manager.addProfile('default', 'token');

    expect(() => readFileSync(join(cwd, '.gitignore'), 'utf8')).toThrow();
  });
});
