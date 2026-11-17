import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_API_URL, resolveCredentials } from '../src/credentials.js';

describe('resolveCredentials', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prefactor-pi-credentials-'));
    filePath = join(dir, 'prefactor.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeFile = (contents: Record<string, unknown>) =>
    writeFileSync(filePath, JSON.stringify(contents));

  test('prefers options, then the environment, then the file', async () => {
    writeFile({ api_url: 'https://file.example', api_token: 'file-token', agent_id: 'file-agent' });
    const env = {
      PREFACTOR_API_URL: 'https://env.example',
      PREFACTOR_API_TOKEN: 'env-token',
      PREFACTOR_AGENT_ID: 'env-agent',
    };

    expect(await resolveCredentials({ apiToken: 'code-token' }, env, filePath)).toEqual({
      source: 'options',
      apiUrl: 'https://env.example',
      apiToken: 'code-token',
    });
    expect(await resolveCredentials({}, env, filePath)).toEqual({
      source: 'environment',
      apiUrl: 'https://env.example',
      apiToken: 'env-token',
      agentId: 'env-agent',
    });
    expect(await resolveCredentials({}, {}, filePath)).toEqual({
      source: 'file',
      apiUrl: 'https://file.example',
      apiToken: 'file-token',
      agentId: 'file-agent',
    });
  });

  test('takes the agent id only from the source that supplied the token', async () => {
    const credentials = await resolveCredentials(
      {},
      { PREFACTOR_API_TOKEN: 'env-token' },
      join(dir, 'missing.json')
    );
    expect(credentials).toEqual({
      source: 'environment',
      apiUrl: DEFAULT_API_URL,
      apiToken: 'env-token',
    });
  });

  test('does not apply a higher-priority URL to a lower-priority token', async () => {
    writeFile({ api_token: 'file-token' });
    const credentials = await resolveCredentials(
      { apiUrl: 'https://code.example' },
      { PREFACTOR_API_URL: 'https://env.example' },
      filePath
    );
    expect(credentials?.apiUrl).toBe(DEFAULT_API_URL);
  });

  test('returns undefined when no source has a token', async () => {
    writeFile({ api_url: 'https://file.example', api_token: ' ' });
    expect(await resolveCredentials({}, {}, filePath)).toBeUndefined();
  });

  test('does not read the file when options or the environment supply a token and URL', async () => {
    writeFileSync(filePath, '[]');
    expect(
      await resolveCredentials(
        { apiUrl: 'https://code.example', apiToken: 'code-token' },
        {},
        filePath
      )
    ).toEqual({ source: 'options', apiUrl: 'https://code.example', apiToken: 'code-token' });
    expect(
      await resolveCredentials(
        {},
        { PREFACTOR_API_URL: 'https://env.example', PREFACTOR_API_TOKEN: 'env-token' },
        filePath
      )
    ).toEqual({ source: 'environment', apiUrl: 'https://env.example', apiToken: 'env-token' });
  });

  test('falls back to the URL in the file for a token from the options', async () => {
    writeFile({ api_url: 'https://file.example', api_token: 'file-token' });
    const credentials = await resolveCredentials({ apiToken: 'code-token' }, {}, filePath);
    expect(credentials).toEqual({
      source: 'options',
      apiUrl: 'https://file.example',
      apiToken: 'code-token',
    });
  });

  test('rejects a credentials file that is not a JSON object', async () => {
    writeFileSync(filePath, '[]');
    await expect(resolveCredentials({}, {}, filePath)).rejects.toThrow(
      'does not hold a JSON object'
    );
  });
});
