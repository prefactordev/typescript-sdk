import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCli } from '../src/cli.js';

type CapturedRequest = {
  url: string;
  init?: RequestInit;
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CLI setup command', () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const originalProfile = process.env.PREFACTOR_PROFILE;
  const originalToken = process.env.PREFACTOR_API_TOKEN;
  const originalApiUrl = process.env.PREFACTOR_API_URL;
  const originalSelfPath = process.env.PREFACTOR_CLI_SELF_PATH;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-cli-setup-test-'));
    process.env.PREFACTOR_CLI_SELF_PATH = join(tempRoot, '.prefactor', 'bin', 'prefactor');
    delete process.env.PREFACTOR_PROFILE;
    delete process.env.PREFACTOR_API_TOKEN;
    delete process.env.PREFACTOR_API_URL;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    globalThis.fetch = originalFetch;

    if (originalProfile === undefined) {
      delete process.env.PREFACTOR_PROFILE;
    } else {
      process.env.PREFACTOR_PROFILE = originalProfile;
    }

    if (originalToken === undefined) {
      delete process.env.PREFACTOR_API_TOKEN;
    } else {
      process.env.PREFACTOR_API_TOKEN = originalToken;
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

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('retrieves the agent before creating an agent-deployment-scoped token and prints setup values', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'profile-token', base_url: 'https://api.example.test' },
      })
    );

    const calls: CapturedRequest[] = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), init });

      if (calls.length === 1) {
        return jsonResponse({ details: { id: 'agent_123', name: 'Support agent' } });
      }

      if (calls.length === 2) {
        return jsonResponse({
          summaries: [
            {
              id: 'deployment_123',
              agent_id: 'agent_123',
              environment_id: 'env_123',
              current_version_id: null,
            },
          ],
        });
      }

      return jsonResponse({
        details: { id: 'api_token_123', token_scope: 'agent_deployment' },
        token: 'runtime-token',
      });
    }) as typeof fetch;

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync(['node', 'prefactor', 'setup', 'agent_123']);
    } finally {
      console.log = originalLog;
    }

    expect(calls).toHaveLength(3);
    expect(new URL(calls[0].url).pathname).toBe('/api/v1/agent/agent_123');
    expect(calls[0].init?.method).toBe('GET');
    expect(new URL(calls[1].url).pathname).toBe('/api/v1/agent_deployment');
    expect(new URL(calls[1].url).searchParams.get('agent_id')).toBe('agent_123');
    expect(calls[1].init?.method).toBe('GET');
    expect(new URL(calls[2].url).pathname).toBe('/api/v1/api_token');
    expect(calls[2].init?.method).toBe('POST');
    expect(calls[2].init?.body).toBe(
      '{"details":{"token_scope":"agent_deployment","agent_id":"agent_123","environment_id":"env_123"}}'
    );

    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('PREFACTOR_API_URL=https://api.example.test');
    expect(output).toContain('PREFACTOR_API_TOKEN=runtime-token');
    expect(output).toContain('PREFACTOR_AGENT_ID=agent_123');
    expect(output).toContain('PREFACTOR_AGENT_IDENTIFIER=1.0.0');
    expect(existsSync(join(cwd, '.env'))).toBeFalse();
    expect(readFileSync(join(cwd, 'prefactor.json'), 'utf8')).toContain('profile-token');
  });

  test('uses the global profile option', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'default-token', base_url: 'https://default.example.test' },
        team: { api_key: 'team-token', base_url: 'https://team.example.test' },
      })
    );

    const calls: CapturedRequest[] = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) {
        return jsonResponse({ details: { id: 'agent_456', name: 'Team agent' } });
      }

      if (calls.length === 2) {
        return jsonResponse({
          summaries: [
            {
              id: 'deployment_456',
              agent_id: 'agent_456',
              environment_id: 'env_456',
              current_version_id: null,
            },
          ],
        });
      }

      return jsonResponse({ details: { id: 'api_token_456' }, token: 'team-runtime-token' });
    }) as typeof fetch;

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync([
        'node',
        'prefactor',
        '--profile',
        'team',
        'setup',
        'agent_456',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(
      calls.every((call) => new URL(call.url).origin === 'https://team.example.test')
    ).toBeTrue();
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('PREFACTOR_API_URL=https://team.example.test');
    expect(output).toContain('PREFACTOR_API_TOKEN=team-runtime-token');
  });

  test('selects the only deployment with a current version when multiple deployments exist', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'profile-token', base_url: 'https://api.example.test' },
      })
    );

    let tokenBody = '';
    globalThis.fetch = (async (input, init) => {
      const path = new URL(String(input)).pathname;

      if (path === '/api/v1/agent/agent_789') {
        return jsonResponse({ details: { id: 'agent_789', name: 'Support agent' } });
      }

      if (path === '/api/v1/agent_deployment') {
        return jsonResponse({
          summaries: [
            {
              id: 'deployment_without_version',
              agent_id: 'agent_789',
              environment_id: 'env_without_version',
              current_version_id: null,
            },
            {
              id: 'deployment_with_version',
              agent_id: 'agent_789',
              environment_id: 'env_with_version',
              current_version_id: 'version_789',
            },
          ],
        });
      }

      tokenBody = String(init?.body);
      return jsonResponse({ details: { id: 'api_token_789' }, token: 'runtime-token' });
    }) as typeof fetch;

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync(['node', 'prefactor', 'setup', 'agent_789']);
    } finally {
      console.log = originalLog;
    }

    expect(tokenBody).toBe(
      '{"details":{"token_scope":"agent_deployment","agent_id":"agent_789","environment_id":"env_with_version"}}'
    );
  });

  test('does not list accounts during setup', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'profile-token', base_url: 'https://api.example.test' },
      })
    );

    const paths: string[] = [];
    globalThis.fetch = (async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);

      if (path === '/api/v1/account') {
        throw new Error('setup must not list accounts');
      }

      if (path === '/api/v1/agent/agent_no_account') {
        return jsonResponse({ details: { id: 'agent_no_account', name: 'Support agent' } });
      }

      if (path === '/api/v1/agent_deployment') {
        return jsonResponse({
          summaries: [
            {
              id: 'deployment_no_account',
              agent_id: 'agent_no_account',
              environment_id: 'env_no_account',
              current_version_id: null,
            },
          ],
        });
      }

      return jsonResponse({ details: { id: 'api_token_no_account' }, token: 'runtime-token' });
    }) as typeof fetch;

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await createCli('1.0.0').parseAsync(['node', 'prefactor', 'setup', 'agent_no_account']);
    } finally {
      console.log = originalLog;
    }

    expect(paths).toEqual([
      '/api/v1/agent/agent_no_account',
      '/api/v1/agent_deployment',
      '/api/v1/api_token',
    ]);
  });

  test('creates a deployment when none exist and prints setup values', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'profile-token', base_url: 'https://api.example.test' },
      })
    );

    const calls: CapturedRequest[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url: String(input), init });
      const path = url.pathname;
      const method = init?.method ?? 'GET';

      if (path === '/api/v1/agent/agent_new' && method === 'GET') {
        return jsonResponse({ details: { id: 'agent_new', name: 'New agent' } });
      }

      if (path === '/api/v1/agent_deployment' && method === 'GET') {
        return jsonResponse({ summaries: [] });
      }

      if (path === '/api/v1/account' && method === 'GET') {
        return jsonResponse({
          summaries: [{ id: 'account_abc', name: 'My Account' }],
        });
      }

      if (path === '/api/v1/environment' && method === 'GET') {
        expect(url.searchParams.get('account_id')).toBe('account_abc');
        return jsonResponse({
          summaries: [{ id: 'env_abc', name: 'Production', account_id: 'account_abc' }],
        });
      }

      if (path === '/api/v1/agent_deployment' && method === 'POST') {
        expect(init?.body).toBe('{"details":{"agent_id":"agent_new","environment_id":"env_abc"}}');
        return jsonResponse({
          details: {
            id: 'deployment_new',
            agent_id: 'agent_new',
            environment_id: 'env_abc',
            account_id: 'account_abc',
            current_version_id: null,
          },
        });
      }

      if (path === '/api/v1/api_token' && method === 'POST') {
        return jsonResponse({
          details: { id: 'api_token_new', token_scope: 'agent_deployment' },
          token: 'runtime-token-new',
        });
      }

      throw new Error(`Unexpected request: ${method} ${path}`);
    }) as typeof fetch;

    const log = mock(() => {});
    const errorLog = mock(() => {});
    const originalLog = console.log;
    const originalError = console.error;
    console.log = log;
    console.error = errorLog;

    try {
      await createCli('1.0.0').parseAsync(['node', 'prefactor', 'setup', 'agent_new']);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    expect(calls).toHaveLength(6);
    expect(new URL(calls[0].url).pathname).toBe('/api/v1/agent/agent_new');
    expect(new URL(calls[1].url).pathname).toBe('/api/v1/agent_deployment');
    expect(calls[1].init?.method).toBe('GET');
    expect(new URL(calls[2].url).pathname).toBe('/api/v1/account');
    expect(new URL(calls[3].url).pathname).toBe('/api/v1/environment');
    expect(new URL(calls[4].url).pathname).toBe('/api/v1/agent_deployment');
    expect(calls[4].init?.method).toBe('POST');
    expect(new URL(calls[5].url).pathname).toBe('/api/v1/api_token');
    expect(calls[5].init?.body).toBe(
      '{"details":{"token_scope":"agent_deployment","agent_id":"agent_new","environment_id":"env_abc"}}'
    );

    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('PREFACTOR_API_URL=https://api.example.test');
    expect(output).toContain('PREFACTOR_API_TOKEN=runtime-token-new');
    expect(output).toContain('PREFACTOR_AGENT_ID=agent_new');
    expect(output).toContain('PREFACTOR_AGENT_IDENTIFIER=1.0.0');

    const stderr = errorLog.mock.calls.flat().join('\n');
    expect(stderr).toContain('Created agent deployment');
    expect(stderr).toContain('env_abc');
    expect(stderr).toContain('account_abc');
  });

  test('throws when no accounts are accessible and does not create a deployment', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'profile-token', base_url: 'https://api.example.test' },
      })
    );

    const paths: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      paths.push(`${method} ${path}`);

      if (path === '/api/v1/agent/agent_no_accounts') {
        return jsonResponse({ details: { id: 'agent_no_accounts', name: 'Agent' } });
      }

      if (path === '/api/v1/agent_deployment' && method === 'GET') {
        return jsonResponse({ summaries: [] });
      }

      if (path === '/api/v1/account') {
        return jsonResponse({ summaries: [] });
      }

      if (path === '/api/v1/environment') {
        throw new Error('setup must not list environments when there are no accounts');
      }

      if (path === '/api/v1/api_token') {
        throw new Error('setup must not create api token when there are no accounts');
      }

      throw new Error(`Unexpected request: ${method} ${path}`);
    }) as typeof fetch;

    await expect(
      createCli('1.0.0').parseAsync(['node', 'prefactor', 'setup', 'agent_no_accounts'])
    ).rejects.toThrow('No accounts accessible to this profile; cannot create a deployment.');

    expect(paths).toEqual([
      'GET /api/v1/agent/agent_no_accounts',
      'GET /api/v1/agent_deployment',
      'GET /api/v1/account',
    ]);
  });

  test('throws when the account has no environments and does not create a deployment', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'profile-token', base_url: 'https://api.example.test' },
      })
    );

    const paths: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      paths.push(`${method} ${path}`);

      if (path === '/api/v1/agent/agent_no_envs') {
        return jsonResponse({ details: { id: 'agent_no_envs', name: 'Agent' } });
      }

      if (path === '/api/v1/agent_deployment' && method === 'GET') {
        return jsonResponse({ summaries: [] });
      }

      if (path === '/api/v1/account') {
        return jsonResponse({
          summaries: [{ id: 'account_empty', name: 'Empty Account' }],
        });
      }

      if (path === '/api/v1/environment') {
        return jsonResponse({ summaries: [] });
      }

      if (path === '/api/v1/agent_deployment' && method === 'POST') {
        throw new Error('setup must not create deployment when there are no environments');
      }

      if (path === '/api/v1/api_token') {
        throw new Error('setup must not create api token when there are no environments');
      }

      throw new Error(`Unexpected request: ${method} ${path}`);
    }) as typeof fetch;

    await expect(
      createCli('1.0.0').parseAsync(['node', 'prefactor', 'setup', 'agent_no_envs'])
    ).rejects.toThrow('No environments found for account account_empty; create one first.');

    expect(paths).toEqual([
      'GET /api/v1/agent/agent_no_envs',
      'GET /api/v1/agent_deployment',
      'GET /api/v1/account',
      'GET /api/v1/environment',
    ]);
  });
});
