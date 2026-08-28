import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCli } from '../src/cli.js';

describe('CLI profiles command', () => {
  const originalCwd = process.cwd();
  const originalProfile = process.env.PREFACTOR_PROFILE;
  const originalSelfPath = process.env.PREFACTOR_CLI_SELF_PATH;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-cli-test-'));
    delete process.env.PREFACTOR_PROFILE;
    process.env.PREFACTOR_CLI_SELF_PATH = join(tempRoot, '.prefactor', 'bin', 'prefactor');
  });

  afterEach(() => {
    process.chdir(originalCwd);

    if (originalProfile === undefined) {
      delete process.env.PREFACTOR_PROFILE;
    } else {
      process.env.PREFACTOR_PROFILE = originalProfile;
    }

    if (originalSelfPath === undefined) {
      delete process.env.PREFACTOR_CLI_SELF_PATH;
    } else {
      process.env.PREFACTOR_CLI_SELF_PATH = originalSelfPath;
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
      'login',
      'profiles',
      'accounts',
      'agents',
      'environments',
      'agent_versions',
      'agent_schema_versions',
      'agent_instances',
      'agent_deployments',
      'agent_spans',
      'alerts',
      'people',
      'teams',
      'risk_profiles',
      'playground',
      'admin_users',
      'admin_user_invites',
      'api_tokens',
      'setup',
      'pfid',
      'bulk',
      'ping',
      'version',
      'install',
      'update',
      'uninstall',
      'doctor',
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
        '--api-token',
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
        'not-a-url',
        '--api-token',
        'api-key',
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
      "No profiles configured. Use 'prefactor profiles add <name> [baseUrl] --api-token <apiToken>'."
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
  const originalProfile = process.env.PREFACTOR_PROFILE;
  const originalApiToken = process.env.PREFACTOR_API_TOKEN;
  const originalApiUrl = process.env.PREFACTOR_API_URL;
  const originalSelfPath = process.env.PREFACTOR_CLI_SELF_PATH;
  const originalFetch = globalThis.fetch;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-cli-test-'));
    delete process.env.PREFACTOR_PROFILE;
    delete process.env.PREFACTOR_API_TOKEN;
    delete process.env.PREFACTOR_API_URL;
    process.env.PREFACTOR_CLI_SELF_PATH = join(tempRoot, '.prefactor', 'bin', 'prefactor');
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.chdir(originalCwd);

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

    if (originalSelfPath === undefined) {
      delete process.env.PREFACTOR_CLI_SELF_PATH;
    } else {
      process.env.PREFACTOR_CLI_SELF_PATH = originalSelfPath;
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
      "No profile found for 'default'. Run 'prefactor profiles add <name> [baseUrl] --api-token <apiToken>' to configure one."
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
      "No profile found for 'missing'. Run 'prefactor profiles add <name> [baseUrl] --api-token <apiToken>' to configure one."
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
      "No profile found for 'missing-from-env'. Run 'prefactor profiles add <name> [baseUrl] --api-token <apiToken>' to configure one."
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
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync(['node', 'prefactor', 'accounts', 'list']);

    expect(requestUrl).toStartWith('https://app.prefactorai.com/');
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
      return new Response(JSON.stringify({ summaries: [] }), {
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
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const cli = createCli('1.0.0');
    await cli.parseAsync(['node', 'prefactor', 'accounts', 'list']);

    expect(requestUrl).toStartWith('https://profile-api.example/');
  });

  test('ping with api token uses default API URL', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    let requestUrl = '';
    let authorization = '';
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      return new Response(JSON.stringify({ status: 'success', details: { token_type: 'api' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync([
        'node',
        'prefactor',
        'ping',
        '--api-token',
        'dep-token',
      ]);
    } finally {
      console.log = originalLog;
    }

    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://app.prefactorai.com/api/v1/ping');
    expect(authorization).toBe('Bearer dep-token');
    expect(log.mock.calls.flat().join('\n')).toContain('"status": "success"');
  });

  test('ping with api token uses explicit API URL', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    let requestUrl = '';
    let authorization = '';
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      return new Response(JSON.stringify({ status: 'success', details: { token_type: 'api' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'ping',
      '--api-url',
      'https://api.example',
      '--api-token',
      'dep-token',
    ]);

    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://api.example/api/v1/ping');
    expect(authorization).toBe('Bearer dep-token');
  });

  test('ping without api token uses existing profile auth', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'profile-token', base_url: 'https://profile.example' } })
    );

    let requestUrl = '';
    let authorization = '';
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      return new Response(JSON.stringify({ status: 'success', details: { token_type: 'api' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync(['node', 'prefactor', 'ping']);

    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://profile.example/api/v1/ping');
    expect(authorization).toBe('Bearer profile-token');
  });

  test('ping api token option takes precedence over default profile', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'profile-token', base_url: 'https://profile.example' } })
    );

    let requestUrl = '';
    let authorization = '';
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      return new Response(JSON.stringify({ status: 'success', details: { token_type: 'api' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync(['node', 'prefactor', 'ping', '--api-token', 'dep-token']);

    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://app.prefactorai.com/api/v1/ping');
    expect(authorization).toBe('Bearer dep-token');
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
      "Invalid --token_scope 'invalid_scope'. Allowed values: account, agent_deployment."
    );
  });

  test('requires agent_id and environment_id when token_scope is agent_deployment', async () => {
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
        'agent_deployment',
      ])
    ).rejects.toThrow(
      "--agent_id and --environment_id are required when --token_scope is 'agent_deployment'."
    );
  });

  test('rejects agent_id and environment_id when token_scope is account', async () => {
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
        'account',
        '--agent_id',
        'agent_123',
        '--environment_id',
        'env_123',
      ])
    ).rejects.toThrow(
      "--agent_id and --environment_id must be omitted when --token_scope is 'account'."
    );
  });

  test('api_tokens create treats whitespace-only deployment IDs as missing before request', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    globalThis.fetch = mock(async () => {
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;

    await expect(
      createCli('1.0.0').parseAsync([
        'node',
        'prefactor',
        'api_tokens',
        'create',
        '--token_scope',
        'agent_deployment',
        '--agent_id',
        '   ',
        '--environment_id',
        'env_123',
      ])
    ).rejects.toThrow(
      "--agent_id and --environment_id are required when --token_scope is 'agent_deployment'."
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('api_tokens create trims deployment IDs before sending payload', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ details: { id: 'token_123' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'api_tokens',
      'create',
      '--token_scope',
      'agent_deployment',
      '--agent_id',
      '  agent_123  ',
      '--environment_id',
      '  env_123  ',
    ]);

    expect(bodies).toEqual([
      {
        details: {
          token_scope: 'agent_deployment',
          agent_id: 'agent_123',
          environment_id: 'env_123',
        },
      },
    ]);
  });

  test('agent_deployments update requires at least one update field before auth', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);

    globalThis.fetch = mock(async () => {
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;

    await expect(
      createCli('1.0.0').parseAsync(['node', 'prefactor', 'agent_deployments', 'update', 'dep_123'])
    ).rejects.toThrow('No update fields provided; pass --current_version_id.');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('agent_deployments create and update trim optional IDs in payloads', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ details: { id: 'dep_123' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agent_deployments',
      'create',
      '--agent_id',
      'agent_123',
      '--environment_id',
      'env_123',
      '--id',
      '  013xrzp12g3nqk8n5pj6qzmkvdr8mw1v  ',
      '--current_version_id',
      '  version_123  ',
    ]);
    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agent_deployments',
      'update',
      'dep_123',
      '--current_version_id',
      '  version_456  ',
    ]);

    expect(bodies).toEqual([
      {
        details: {
          agent_id: 'agent_123',
          environment_id: 'env_123',
          id: '013xrzp12g3nqk8n5pj6qzmkvdr8mw1v',
          current_version_id: 'version_123',
        },
      },
      {
        details: {
          current_version_id: 'version_456',
        },
      },
    ]);
  });

  test('agent_deployments update accepts null sentinel to clear current_version_id', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ details: { id: 'dep_123' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agent_deployments',
      'update',
      'dep_123',
      '--current_version_id',
      'null',
    ]);

    expect(bodies).toEqual([
      {
        details: {
          current_version_id: null,
        },
      },
    ]);
  });

  test('agents update sends name and description without current_version_id', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ details: { id: 'agent_123' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agents',
      'update',
      'agent_123',
      '--name',
      'Renamed',
      '--description',
      'Updated description',
    ]);

    expect(capturedBody).toEqual({
      details: {
        name: 'Renamed',
        description: 'Updated description',
      },
    });
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
      '--schema_name',
      'llm',
      '--status',
      'complete',
      '--payload',
      `@${payloadPath}`,
    ]);

    expect(capturedBody).toContain('"payload":{"message":"hello","count":2}');
    expect(capturedBody).toContain('"schema_name":"llm"');
    expect(capturedBody).toContain('"status":"complete"');
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
        '--schema_name',
        'llm',
        '--status',
        'complete',
        '--payload',
        '@/definitely/missing/file.json',
      ])
    ).rejects.toThrow('Unable to read file for --payload:');
  });

  test('agent_instances agent_context retrieves context response', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    globalThis.fetch = (async (input) => {
      capturedPath = new URL(String(input)).pathname;
      return new Response(
        JSON.stringify({
          status: 'success',
          agent_context: { body: { format: 'agent_context_v1' } },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync([
        'node',
        'prefactor',
        'agent_instances',
        'agent_context',
        'agent_instance_1',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(capturedPath).toBe('/api/v1/agent_instance/agent_instance_1/agent_context');
    expect(log.mock.calls.flat().join('\n')).toContain('"agent_context"');
  });

  test('agent_instances register sends id and update_current_version when provided', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ details: { id: 'agent_instance_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agent_instances',
      'register',
      '--agent_id',
      'agent_1',
      '--agent_version_external_identifier',
      'v1',
      '--agent_version_name',
      'Agent',
      '--agent_schema_version_external_identifier',
      'schema_v1',
      '--id',
      '013xrzp12g3nqk8n5pj6qzmkvdr8mw1v',
      '--update_current_version',
    ]);

    expect(capturedBody).toMatchObject({
      agent_id: 'agent_1',
      id: '013xrzp12g3nqk8n5pj6qzmkvdr8mw1v',
      update_current_version: true,
    });
  });

  test('agent_instances terminate sends reason and timestamp', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ details: { id: 'agent_instance_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agent_instances',
      'terminate',
      'agent_instance_1',
      '--reason',
      'operator requested stop',
      '--timestamp',
      '2026-02-24T12:10:00.000Z',
    ]);

    expect(capturedPath).toBe('/api/v1/agent_instance/agent_instance_1/terminate');
    expect(capturedBody).toMatchObject({
      reason: 'operator requested stop',
      timestamp: '2026-02-24T12:10:00.000Z',
    });
  });

  test('admin_users update sends details', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ details: { id: 'admin_user_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'admin_users',
      'update',
      'admin_user_1',
      '--name',
      'Ada Lovelace',
      '--job_title',
      'Engineer',
      '--profile_completed_at',
      '2026-02-24T12:00:00.000Z',
    ]);

    expect(capturedPath).toBe('/api/v1/admin_user/admin_user_1');
    expect(capturedBody).toEqual({
      details: {
        name: 'Ada Lovelace',
        job_title: 'Engineer',
        profile_completed_at: '2026-02-24T12:00:00.000Z',
      },
    });
  });

  test('agents show sends lookup query params', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedUrl = '';
    globalThis.fetch = (async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ details: { id: 'agent_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agents',
      'show',
      '--agent_id',
      'agent_1',
      '--include_counts',
      '--include_risk_rollup',
    ]);

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v1/agent/show');
    expect(url.searchParams.get('agent_id')).toBe('agent_1');
    expect(url.searchParams.get('include_counts')).toBe('true');
    expect(url.searchParams.get('include_risk_rollup')).toBe('true');
  });

  test('agent_instances show sends lookup query params', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedUrl = '';
    globalThis.fetch = (async (input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({ details: { id: 'agent_instance_1' }, status: 'success' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agent_instances',
      'show',
      '--agent_instance_id',
      'agent_instance_1',
      '--include_counts',
      '--include_costs',
    ]);

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v1/agent_instance/show');
    expect(url.searchParams.get('agent_instance_id')).toBe('agent_instance_1');
    expect(url.searchParams.get('include_counts')).toBe('true');
    expect(url.searchParams.get('include_costs')).toBe('true');
  });

  test('environments show sends lookup query params', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedUrl = '';
    globalThis.fetch = (async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ details: { id: 'env_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'environments',
      'show',
      '--environment_id',
      'env_1',
    ]);

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v1/environment/show');
    expect(url.searchParams.get('environment_id')).toBe('env_1');
  });

  test('agent_spans retrieve sends GET with redacted query', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedUrl = '';
    globalThis.fetch = (async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ details: { id: 'span_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agent_spans',
      'retrieve',
      'span_1',
      '--redacted',
    ]);

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v1/agent_spans/span_1');
    expect(url.searchParams.get('redacted')).toBe('true');
  });

  test('agent_spans discard_sensitive posts empty body', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ details: { id: 'span_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agent_spans',
      'discard_sensitive',
      'span_1',
    ]);

    expect(capturedPath).toBe('/api/v1/agent_spans/span_1/discard_sensitive');
    expect(capturedBody).toBe('{}');
  });

  test('alerts list sends nested active_during and pagination query keys', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedUrl = '';
    globalThis.fetch = (async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'alerts',
      'list',
      '--agent_instance_id',
      'agent_instance_1',
      '--status',
      'raised',
      '--severity',
      'warning',
      '--active_during_start_at',
      '2024-01-01T00:00:00Z',
      '--active_during_finish_at',
      '2024-01-02T00:00:00Z',
      '--pagination_offset',
      '0',
      '--pagination_page_size',
      '25',
    ]);

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v1/alerts');
    expect(url.searchParams.get('agent_instance_id')).toBe('agent_instance_1');
    expect(url.searchParams.get('status')).toBe('raised');
    expect(url.searchParams.get('severity')).toBe('warning');
    expect(url.searchParams.get('active_during[start_at]')).toBe('2024-01-01T00:00:00Z');
    expect(url.searchParams.get('active_during[finish_at]')).toBe('2024-01-02T00:00:00Z');
    expect(url.searchParams.get('pagination[offset]')).toBe('0');
    expect(url.searchParams.get('pagination[page_size]')).toBe('25');
  });

  test('alerts raise posts top-level fields without a details wrapper', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ details: { id: 'alert_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'alerts',
      'raise',
      '--agent_instance_id',
      'agent_instance_1',
      '--name',
      'high_error_rate',
      '--severity',
      'warning',
      '--payload',
      '{"count":12}',
      '--payload_sensitive_encoding',
    ]);

    expect(capturedPath).toBe('/api/v1/alerts/raise');
    expect(capturedBody).toBe(
      '{"agent_instance_id":"agent_instance_1","name":"high_error_rate","severity":"warning","payload":{"count":12},"payload_sensitive_encoding":true}'
    );
  });

  test('alerts clear posts required top-level fields without a details wrapper', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ details: { id: 'alert_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'alerts',
      'clear',
      '--agent_instance_id',
      'agent_instance_1',
      '--name',
      'high_error_rate',
    ]);

    expect(capturedPath).toBe('/api/v1/alerts/clear');
    expect(capturedBody).toBe('{"agent_instance_id":"agent_instance_1","name":"high_error_rate"}');
  });

  test('people list sends team_id and nested pagination query keys', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedUrl = '';
    globalThis.fetch = (async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'people',
      'list',
      '--team_id',
      'team_1',
      '--sorting',
      'name',
      '--pagination_offset',
      '0',
      '--pagination_page_size',
      '25',
    ]);

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v1/person');
    expect(url.searchParams.get('team_id')).toBe('team_1');
    expect(url.searchParams.get('sorting')).toBe('name');
    expect(url.searchParams.get('pagination[offset]')).toBe('0');
    expect(url.searchParams.get('pagination[page_size]')).toBe('25');
  });

  test('people create wraps details without an idempotency key', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ details: { id: 'person_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'people',
      'create',
      '--email',
      'jane@example.com',
      '--name',
      'Jane Doe',
      '--team_ids',
      '["team_1"]',
      '--title',
      'Engineer',
    ]);

    expect(capturedPath).toBe('/api/v1/person');
    expect(capturedBody).toBe(
      '{"details":{"email":"jane@example.com","name":"Jane Doe","team_ids":["team_1"],"title":"Engineer"}}'
    );
  });

  test('people update can send an empty team_ids array', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ details: { id: 'person_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'people',
      'update',
      'person_1',
      '--team_ids',
      '[]',
    ]);

    expect(capturedPath).toBe('/api/v1/person/person_1');
    expect(capturedBody).toBe('{"details":{"team_ids":[]}}');
  });

  test('people delete sends DELETE and prints the details envelope', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedMethod = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedMethod = String(init?.method ?? '');
      return new Response(JSON.stringify({ details: { id: 'person_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync(['node', 'prefactor', 'people', 'delete', 'person_1']);

    expect(capturedPath).toBe('/api/v1/person/person_1');
    expect(capturedMethod).toBe('DELETE');
  });

  test('teams list sends nested pagination query keys', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedUrl = '';
    globalThis.fetch = (async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'teams',
      'list',
      '--sorting',
      'name',
      '--pagination_offset',
      '0',
      '--pagination_page_size',
      '25',
    ]);

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v1/team');
    expect(url.searchParams.get('sorting')).toBe('name');
    expect(url.searchParams.get('pagination[offset]')).toBe('0');
    expect(url.searchParams.get('pagination[page_size]')).toBe('25');
  });

  test('teams create wraps details without an idempotency key', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ details: { id: 'team_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'teams',
      'create',
      '--name',
      'Sales',
    ]);

    expect(capturedPath).toBe('/api/v1/team');
    expect(capturedBody).toBe('{"details":{"name":"Sales"}}');
  });

  test('teams delete sends DELETE and prints the details envelope', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedMethod = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedMethod = String(init?.method ?? '');
      return new Response(JSON.stringify({ details: { id: 'team_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync(['node', 'prefactor', 'teams', 'delete', 'team_1']);

    expect(capturedPath).toBe('/api/v1/team/team_1');
    expect(capturedMethod).toBe('DELETE');
  });

  test('risk_profiles template sends template_name without a details wrapper', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedUrl = '';
    globalThis.fetch = (async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ ruleset: {}, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'risk_profiles',
      'template',
      '--template_name',
      'Standard',
    ]);

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/api/v1/risk_profile/template');
    expect(url.searchParams.get('template_name')).toBe('Standard');
  });

  test('risk_profiles create wraps name and ruleset in details', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ details: { id: 'rp_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'risk_profiles',
      'create',
      '--name',
      'Standard',
      '--ruleset',
      '{"thresholds":{"critical":80,"high":50,"medium":20},"action_multipliers":{},"category_weights":{}}',
    ]);

    expect(capturedPath).toBe('/api/v1/risk_profile');
    expect(capturedBody).toBe(
      '{"details":{"name":"Standard","ruleset":{"thresholds":{"critical":80,"high":50,"medium":20},"action_multipliers":{},"category_weights":{}}}}'
    );
  });

  test('playground create_openclaw_agent posts an empty body', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'playground',
      'create_openclaw_agent',
    ]);

    expect(capturedPath).toBe('/api/v1/playground/create_openclaw_agent');
    expect(capturedBody).toBe('{}');
  });

  test('playground record_first_account_spans posts required instance and scenario', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ ids: ['span_1'], status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'playground',
      'record_first_account_spans',
      '--agent_instance_id',
      'agent_instance_1',
      '--scenario',
      'good',
    ]);

    expect(capturedPath).toBe('/api/v1/playground/record_first_account_spans');
    expect(capturedBody).toBe('{"agent_instance_id":"agent_instance_1","scenario":"good"}');
  });

  test('playground register_quality_review_agent_instance posts required ids and purpose', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedPath = '';
    let capturedBody = '';
    globalThis.fetch = (async (input, init) => {
      capturedPath = new URL(String(input)).pathname;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'playground',
      'register_quality_review_agent_instance',
      '--agent_id',
      'agent_1',
      '--environment_id',
      'env_1',
      '--purpose',
      'eval',
    ]);

    expect(capturedPath).toBe('/api/v1/playground/register_quality_review_agent_instance');
    expect(capturedBody).toBe('{"agent_id":"agent_1","environment_id":"env_1","purpose":"eval"}');
  });

  test('agent_instances agent_context writes context body to output file', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: 'success',
          agent_context: { body: { format: 'agent_context_v1', spans: [] } },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    const outputPath = join(cwd, 'context.json');

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'agent_instances',
      'agent_context',
      'agent_instance_1',
      '--output',
      outputPath,
    ]);

    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({
      format: 'agent_context_v1',
      spans: [],
    });
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

  test('requires bulk items to include _type and an 8–128 character idempotency_key', async () => {
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
        'bulk',
        'execute',
        '--items',
        '[{"idempotency_key":"list-agents-001"}]',
      ])
    ).rejects.toThrow('--items[0]._type must be a string.');

    await expect(
      cli.parseAsync([
        'node',
        'prefactor',
        'bulk',
        'execute',
        '--items',
        '[{"_type":"agents/list","idempotency_key":"short"}]',
      ])
    ).rejects.toThrow('--items[0].idempotency_key must be 8–128 characters.');
  });

  test('bulk execute sends _type and idempotency_key items', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({ default: { api_key: 'token', base_url: 'https://example.com' } })
    );

    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ status: 'success', outputs: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await createCli('1.0.0').parseAsync([
      'node',
      'prefactor',
      'bulk',
      'execute',
      '--items',
      JSON.stringify([
        {
          _type: 'agents/create',
          idempotency_key: 'create-agent-001',
          details: { name: 'Support bot' },
        },
      ]),
    ]);

    expect(capturedBody).toEqual({
      items: [
        {
          _type: 'agents/create',
          idempotency_key: 'create-agent-001',
          details: { name: 'Support bot' },
        },
      ],
    });
  });
});
