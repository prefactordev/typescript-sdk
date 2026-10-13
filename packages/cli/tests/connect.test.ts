import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCli } from '../src/cli.js';

type CapturedRequest = {
  url: string;
  init?: RequestInit;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CLI connect command', () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const originalProfile = process.env.PREFACTOR_PROFILE;
  const originalToken = process.env.PREFACTOR_API_TOKEN;
  const originalSelfPath = process.env.PREFACTOR_CLI_SELF_PATH;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-cli-connect-test-'));
    process.env.PREFACTOR_CLI_SELF_PATH = join(tempRoot, '.prefactor', 'bin', 'prefactor');
    delete process.env.PREFACTOR_PROFILE;
    delete process.env.PREFACTOR_API_TOKEN;
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

    if (originalSelfPath === undefined) {
      delete process.env.PREFACTOR_CLI_SELF_PATH;
    } else {
      process.env.PREFACTOR_CLI_SELF_PATH = originalSelfPath;
    }

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('reports the agent and tools without creating an agent', async () => {
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
      return jsonResponse({
        status: 'success',
        details: { id: 'connection_123', agent_name: 'Support chatbot' },
      });
    }) as typeof fetch;

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      await createCli('1.2.3').parseAsync([
        'node',
        'prefactor',
        'connect',
        '--agent-name',
        'Support chatbot',
        '--tool',
        'search_orders:Searches orders by email',
        '--tool',
        'lookup_account',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe('/api/v1/cli_connection');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      cli_version: '1.2.3',
      agent: { name: 'Support chatbot' },
      tools: [
        { name: 'search_orders', description: 'Searches orders by email' },
        { name: 'lookup_account' },
      ],
    });
    expect(JSON.parse(String(calls[0].init?.body)).agent.id).toBeUndefined();
    expect(logs.join('\n')).toContain(
      'Reported a connection for Support chatbot (connection_123).'
    );
  });

  test('sends an existing agent id when one is given', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'profile-token', base_url: 'https://api.example.test' },
      })
    );

    let body = '';
    globalThis.fetch = (async (_input, init) => {
      body = String(init?.body ?? '');
      return jsonResponse({ status: 'success', details: { id: 'connection_456' } });
    }) as typeof fetch;

    await createCli('1.2.3').parseAsync([
      'node',
      'prefactor',
      'connect',
      '--agent-name',
      'Support chatbot',
      '--agent-id',
      'agent_123',
    ]);

    expect(JSON.parse(body).agent).toEqual({ name: 'Support chatbot', id: 'agent_123' });
    expect(JSON.parse(body).tools).toEqual([]);
  });

  test('rejects more than 100 tools before calling the API', async () => {
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    process.chdir(cwd);
    writeFileSync(
      join(cwd, 'prefactor.json'),
      JSON.stringify({
        default: { api_key: 'profile-token', base_url: 'https://api.example.test' },
      })
    );

    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse({ status: 'success', details: {} });
    }) as typeof fetch;

    const args = ['node', 'prefactor', 'connect', '--agent-name', 'Support chatbot'];
    for (let index = 0; index < 101; index += 1) {
      args.push('--tool', `tool_${index}`);
    }

    await expect(createCli('1.2.3').parseAsync(args)).rejects.toThrow(
      'A connection can include at most 100 tools.'
    );
    expect(called).toBeFalse();
  });
});
