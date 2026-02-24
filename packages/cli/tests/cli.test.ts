import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCli } from '../src/cli.js';

describe('CLI profiles command', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalProfile = process.env.PREFACTOR_PROFILE;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-cli-test-'));
    delete process.env.PREFACTOR_PROFILE;
  });

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalProfile === undefined) {
      delete process.env.PREFACTOR_PROFILE;
    } else {
      process.env.PREFACTOR_PROFILE = originalProfile;
    }

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('registers global --profile option and profiles subcommands', () => {
    const cli = createCli('1.0.0');

    expect(cli.options.some((option) => option.long === '--profile')).toBeTrue();

    const profilesCommand = cli.commands.find((command) => command.name() === 'profiles');
    expect(profilesCommand).toBeDefined();
    expect(profilesCommand?.commands.map((command) => command.name())).toEqual([
      'list',
      'add',
      'remove',
    ]);
  });

  test('registers same top-level commands after modularization', () => {
    const cli = createCli('1.0.0');

    expect(cli.commands.map((command) => command.name())).toEqual([
      'profiles',
      'accounts',
      'agents',
      'environments',
      'agent_versions',
      'agent_schema_versions',
      'agent_instances',
      'agent_spans',
      'admin_users',
      'admin_user_invites',
      'api_tokens',
      'pfid',
      'bulk',
      'version',
    ]);
  });

  test('profiles list uses explicit --profile as current selection', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'default-key', base_url: 'https://default.example' },
        team: { api_key: 'team-key', base_url: 'https://team.example' },
      })
    );
    process.chdir(cwd);

    const log = mock(() => {});
    const cli = createCli('1.0.0');
    cli.configureOutput({ writeOut: () => {}, writeErr: () => {} });

    const originalLog = console.log;
    console.log = log;

    try {
      await cli.parseAsync(['node', 'prefactor', '--profile', 'team', 'profiles', 'list']);
    } finally {
      console.log = originalLog;
    }

    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('team (current) - https://team.example');
    expect(output).toContain('default - https://default.example');
  });

  test('profiles list uses PREFACTOR_PROFILE when --profile is omitted', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'default-key', base_url: 'https://default.example' },
        envProfile: { api_key: 'env-key', base_url: 'https://env.example' },
      })
    );
    process.chdir(cwd);
    process.env.PREFACTOR_PROFILE = 'envProfile';

    const log = mock(() => {});
    const cli = createCli('1.0.0');

    const originalLog = console.log;
    console.log = log;

    try {
      await cli.parseAsync(['node', 'prefactor', 'profiles', 'list']);
    } finally {
      console.log = originalLog;
    }

    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('envProfile (current) - https://env.example');
  });

  test('profiles list falls back to default profile name', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'default-key', base_url: 'https://default.example' },
        extra: { api_key: 'extra-key', base_url: 'https://extra.example' },
      })
    );
    process.chdir(cwd);

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync(['node', 'prefactor', 'profiles', 'list']);
    } finally {
      console.log = originalLog;
    }

    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('default (current) - https://default.example');
    expect(output).toContain('extra - https://extra.example');
  });

  test('profiles add and remove print success messages', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync([
        'node',
        'prefactor',
        'profiles',
        'add',
        'demo',
        'api-key',
      ]);
      await createCli('1.0.0').parseAsync(['node', 'prefactor', 'profiles', 'remove', 'demo']);
    } finally {
      console.log = originalLog;
    }

    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain("Profile 'demo' saved.");
    expect(output).toContain("Profile 'demo' removed.");
  });

  test('profiles add validates baseUrl', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    await expect(
      createCli('1.0.0').parseAsync([
        'node',
        'prefactor',
        'profiles',
        'add',
        'demo',
        'api-key',
        'not-a-url',
      ])
    ).rejects.toThrow('--baseUrl must be a valid URL.');
  });

  test('profiles list shows guidance when no profiles are configured', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync(['node', 'prefactor', 'profiles', 'list']);
    } finally {
      console.log = originalLog;
    }

    expect(log.mock.calls.flat().join('\n')).toContain(
      "No profiles configured. Use 'prefactor profiles add <name> <apiKey> [baseUrl]'."
    );
  });

  test('profiles list does not crash with malformed entries', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'default-key', base_url: 'https://default.example' },
        broken: null,
      })
    );
    process.chdir(cwd);

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync(['node', 'prefactor', 'profiles', 'list']);
    } finally {
      console.log = originalLog;
    }

    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('default (current) - https://default.example');
    expect(output).not.toContain('broken');
  });
});

describe('CLI command validation', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalProfile = process.env.PREFACTOR_PROFILE;
  const originalApiToken = process.env.PREFACTOR_API_TOKEN;
  const originalApiUrl = process.env.PREFACTOR_API_URL;
  const originalFetch = globalThis.fetch;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-cli-test-'));
    delete process.env.PREFACTOR_PROFILE;
    delete process.env.PREFACTOR_API_TOKEN;
    delete process.env.PREFACTOR_API_URL;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalProfile === undefined) {
      delete process.env.PREFACTOR_PROFILE;
    } else {
      process.env.PREFACTOR_PROFILE = originalProfile;
    }

    if (originalApiToken === undefined) {
      delete process.env.PREFACTOR_API_TOKEN;
    } else {
      process.env.PREFACTOR_API_TOKEN = originalApiToken;
    }

    if (originalApiUrl === undefined) {
      delete process.env.PREFACTOR_API_URL;
    } else {
      process.env.PREFACTOR_API_URL = originalApiUrl;
    }

    globalThis.fetch = originalFetch;

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('shows helpful error when selected profile is missing', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    const cli = createCli('1.0.0');

    await expect(cli.parseAsync(['node', 'prefactor', 'accounts', 'list'])).rejects.toThrow(
      "No profile found for 'default'. Run 'prefactor profiles add <name> <apiKey> [baseUrl]' to configure one."
    );
  });

  test('does not fallback to env token when --profile is provided and missing', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    process.env.PREFACTOR_API_TOKEN = 'env-token';

    await expect(
      createCli('1.0.0').parseAsync([
        'node',
        'prefactor',
        '--profile',
        'missing',
        'accounts',
        'list',
      ])
    ).rejects.toThrow(
      "No profile found for 'missing'. Run 'prefactor profiles add <name> <apiKey> [baseUrl]' to configure one."
    );
  });

  test('does not fallback to env token when PREFACTOR_PROFILE is set and missing', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    process.env.PREFACTOR_API_TOKEN = 'env-token';
    process.env.PREFACTOR_PROFILE = 'missing-from-env';

    await expect(
      createCli('1.0.0').parseAsync(['node', 'prefactor', 'accounts', 'list'])
    ).rejects.toThrow(
      "No profile found for 'missing-from-env'. Run 'prefactor profiles add <name> <apiKey> [baseUrl]' to configure one."
    );
  });

  test('falls back to env token for default profile selection', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    process.env.PREFACTOR_API_TOKEN = 'env-token';
    delete process.env.PREFACTOR_PROFILE;
    let requestUrl = '';
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ details: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync(['node', 'prefactor', 'accounts', 'list']);

    expect(requestUrl).toStartWith('https://api.prefactor.ai/');
  });

  test('uses PREFACTOR_API_URL with env token fallback when profile is missing', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    process.env.PREFACTOR_API_TOKEN = 'env-token';
    process.env.PREFACTOR_API_URL = 'https://env-api.example';

    let requestUrl = '';
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ details: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const cli = createCli('1.0.0');
    await cli.parseAsync(['node', 'prefactor', 'accounts', 'list']);

    expect(requestUrl).toStartWith('https://env-api.example/');
  });

  test('prefers configured profile over env-token fallback', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    process.env.PREFACTOR_API_TOKEN = 'env-token';
    process.env.PREFACTOR_API_URL = 'https://env-api.example';
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'profile-token', base_url: 'https://profile-api.example' },
      })
    );

    let requestUrl = '';
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ details: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const cli = createCli('1.0.0');
    await cli.parseAsync(['node', 'prefactor', 'accounts', 'list']);

    expect(requestUrl).toStartWith('https://profile-api.example/');
  });

  test('validates api_tokens create token_scope', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const cli = createCli('1.0.0');

    await expect(
      cli.parseAsync([
        'node',
        'prefactor',
        'api_tokens',
        'create',
        '--token_scope',
        'invalid_scope',
      ])
    ).rejects.toThrow(
      "Invalid --token_scope 'invalid_scope'. Allowed values: account, environment."
    );
  });

  test('requires environment_id when token_scope is environment', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const cli = createCli('1.0.0');

    await expect(
      cli.parseAsync(['node', 'prefactor', 'api_tokens', 'create', '--token_scope', 'environment'])
    ).rejects.toThrow("--environment_id is required when --token_scope is 'environment'.");
  });

  test('supports @file JSON parsing for --payload', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const payloadPath = join(cwd, 'payload.json');
    writeFileSync(payloadPath, JSON.stringify({ message: 'hello', count: 2 }));

    let capturedBody = '';
    globalThis.fetch = (async (_input, init) => {
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ details: { id: 'span_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const cli = createCli('1.0.0');

    await cli.parseAsync([
      'node',
      'prefactor',
      'agent_spans',
      'create',
      '--agent_instance_id',
      'agent_instance_1',
      '--payload',
      `@${payloadPath}`,
    ]);

    expect(capturedBody).toContain('"payload":{"message":"hello","count":2}');
  });

  test('includes option context when @file JSON path cannot be read', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const cli = createCli('1.0.0');

    await expect(
      cli.parseAsync([
        'node',
        'prefactor',
        'agent_spans',
        'create',
        '--agent_instance_id',
        'agent_instance_1',
        '--payload',
        '@/definitely/missing/file.json',
      ])
    ).rejects.toThrow('Unable to read file for --payload:');
  });

  test('enforces mutually exclusive span schema options', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const cli = createCli('1.0.0');

    await expect(
      cli.parseAsync([
        'node',
        'prefactor',
        'agent_schema_versions',
        'create',
        '--agent_id',
        'agent_1',
        '--external_identifier',
        'schema_v1',
        '--span_schemas',
        '{}',
        '--span_type_schemas',
        '[]',
      ])
    ).rejects.toThrow('Use only one of --span_schemas or --span_type_schemas.');
  });

  test('requires --span_result_schemas to be used with --span_schemas', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const cli = createCli('1.0.0');

    await expect(
      cli.parseAsync([
        'node',
        'prefactor',
        'agent_schema_versions',
        'create',
        '--agent_id',
        'agent_1',
        '--external_identifier',
        'schema_v1',
        '--span_result_schemas',
        '{}',
      ])
    ).rejects.toThrow('--span_result_schemas can only be used with --span_schemas.');
  });

  test('requires --items JSON to be an array for bulk execute', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const cli = createCli('1.0.0');

    await expect(
      cli.parseAsync(['node', 'prefactor', 'bulk', 'execute', '--items', '{}'])
    ).rejects.toThrow('--items must be a JSON array.');
  });
});
