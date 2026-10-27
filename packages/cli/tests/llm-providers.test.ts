import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiClient } from '../src/api-client.js';
import { createCli } from '../src/cli.js';
import { ProfileManager } from '../src/profile-manager.js';

const response = { details: { id: 'provider_1' }, status: 'success' };
let requests: { path: string; options: unknown }[];
let replies: unknown[];
let request: ReturnType<typeof spyOn>;
let profile: ReturnType<typeof spyOn>;
let log: ReturnType<typeof spyOn>;

beforeEach(() => {
  requests = [];
  replies = [];
  request = spyOn(ApiClient.prototype, 'request').mockImplementation(async (path, options) => {
    requests.push({ path, options });
    return replies.shift();
  });
  profile = spyOn(ProfileManager.prototype, 'getProfile').mockReturnValue({
    api_key: 'test-token',
    base_url: 'https://example.com',
  });
  log = spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  request.mockRestore();
  profile.mockRestore();
  log.mockRestore();
});

async function run(group: string, ...args: string[]): Promise<void> {
  await createCli('test')
    .exitOverride()
    .parseAsync([group, ...args], { from: 'user' });
}

test('llm_providers create reads the API key from a file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-'));
  const key = join(dir, 'key.txt');
  writeFileSync(key, 'sk-test\n');
  replies = [response];
  try {
    await run(
      'llm_providers',
      'create',
      '--name',
      'Anthropic production',
      '--provider',
      'anthropic',
      '--api_key',
      `@${key}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(requests).toEqual([
    {
      path: '/llm_provider',
      options: {
        method: 'POST',
        body: {
          details: { name: 'Anthropic production', provider: 'anthropic', api_key: 'sk-test' },
        },
      },
    },
  ]);
});

test('llm_providers create sends the endpoint for a custom provider', async () => {
  replies = [response];
  await run(
    'llm_providers',
    'create',
    '--name',
    'Internal',
    '--provider',
    'custom_openai',
    '--api_key',
    'sk-test',
    '--api_base_url',
    'https://llm.example.com/v1'
  );
  expect(requests).toEqual([
    {
      path: '/llm_provider',
      options: {
        method: 'POST',
        body: {
          details: {
            name: 'Internal',
            provider: 'custom_openai',
            api_key: 'sk-test',
            api_base_url: 'https://llm.example.com/v1',
          },
        },
      },
    },
  ]);
});

test('llm_providers update needs a field', async () => {
  await expect(run('llm_providers', 'update', 'provider_1')).rejects.toThrow(
    'No fields provided to update'
  );
  expect(requests).toEqual([]);
});

test('llm_providers list, retrieve, and delete call the provider endpoints', async () => {
  replies = [{ summaries: [], status: 'success' }, response, response];
  await run('llm_providers', 'list');
  await run('llm_providers', 'retrieve', 'provider_1');
  await run('llm_providers', 'delete', 'provider_1');
  expect(requests).toEqual([
    { path: '/llm_provider', options: { method: 'GET', query: {} } },
    { path: '/llm_provider/provider_1', options: { method: 'GET' } },
    { path: '/llm_provider/provider_1', options: { method: 'DELETE' } },
  ]);
});

test('llm_provider_models create sends the models.dev pair', async () => {
  replies = [response];
  await run(
    'llm_provider_models',
    'create',
    '--llm_provider_id',
    'provider_1',
    '--api_name',
    'example-70b',
    '--name',
    'Example 70B',
    '--models_dev_provider',
    'togetherai',
    '--models_dev_model_name',
    'example-70b'
  );
  expect(requests).toEqual([
    {
      path: '/llm_provider_model',
      options: {
        method: 'POST',
        body: {
          details: {
            llm_provider_id: 'provider_1',
            api_name: 'example-70b',
            name: 'Example 70B',
            models_dev_provider: 'togetherai',
            models_dev_model_name: 'example-70b',
          },
        },
      },
    },
  ]);
});

test('llm_provider_models list asks for the provider', async () => {
  replies = [{ summaries: [], status: 'success' }];
  await run('llm_provider_models', 'list', '--llm_provider_id', 'provider_1');
  expect(requests).toEqual([
    {
      path: '/llm_provider_model',
      options: { method: 'GET', query: { llm_provider_id: 'provider_1' } },
    },
  ]);
});

test('llm_provider_models update and delete call the model endpoints', async () => {
  replies = [response, response];
  await run('llm_provider_models', 'update', 'model_1', '--name', 'Renamed');
  await run('llm_provider_models', 'delete', 'model_1');
  expect(requests).toEqual([
    {
      path: '/llm_provider_model/model_1',
      options: { method: 'PUT', body: { details: { name: 'Renamed' } } },
    },
    { path: '/llm_provider_model/model_1', options: { method: 'DELETE' } },
  ]);
});
