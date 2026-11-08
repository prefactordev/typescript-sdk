import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiClient } from '../src/api-client.js';
import { createCli } from '../src/cli.js';
import { ProfileManager } from '../src/profile-manager.js';

const response = {
  markers_valid: true,
  output: { email: 'a@example.com' },
  payload_valid: true,
  problems: [],
  sensitive_encoding: false,
  status: 'success',
};
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
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
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

async function run(...args: string[]): Promise<void> {
  await createCli('test')
    .exitOverride()
    .parseAsync(['utils', ...args], { from: 'user' });
}

const renderResponse = {
  results: [{ errors: [], rendered: 'hello' }],
  status: 'success',
};

const validateResponse = {
  problems: [],
  status: 'success',
  valid: true,
};

test('render_liquid_template sends the template and samples', async () => {
  replies = [renderResponse];
  await run(
    'render_liquid_template',
    '--template',
    'Hello {{ name }}',
    '--samples',
    '[{"payload":{"name":"Ada"},"result_payload":null}]'
  );
  expect(requests).toEqual([
    {
      path: '/utils/render_liquid_template',
      options: {
        method: 'POST',
        body: {
          template: 'Hello {{ name }}',
          samples: [{ payload: { name: 'Ada' }, result_payload: null }],
        },
      },
    },
  ]);
  expect(log).toHaveBeenCalledWith(JSON.stringify(renderResponse, null, 2));
});

test('render_liquid_template reads a template file as text and samples as JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prefactor-utils-'));
  const templatePath = join(dir, 'template.liquid');
  const samplesPath = join(dir, 'samples.json');
  await writeFile(templatePath, 'Hello {{ name }}');
  await writeFile(samplesPath, '[{"payload":{"name":"Ada"}}]');
  replies = [renderResponse];
  await run(
    'render_liquid_template',
    '--template',
    `@${templatePath}`,
    '--samples',
    `@${samplesPath}`
  );
  expect(requests[0]).toEqual({
    path: '/utils/render_liquid_template',
    options: {
      method: 'POST',
      body: {
        template: 'Hello {{ name }}',
        samples: [{ payload: { name: 'Ada' } }],
      },
    },
  });
});

test('render_liquid_template rejects a sample without an object payload', async () => {
  await expect(
    run('render_liquid_template', '--template', 'Hello', '--samples', '[{"payload":"Ada"}]')
  ).rejects.toThrow('--samples[0].payload must be a JSON object.');
  expect(requests).toEqual([]);
});

test('validate_schema sends the schema and omits payload', async () => {
  replies = [validateResponse];
  await run('validate_schema', '--schema', '{"type":"object"}');
  expect(requests).toEqual([
    {
      path: '/utils/validate_schema',
      options: {
        method: 'POST',
        body: { schema: { type: 'object' } },
      },
    },
  ]);
  expect(log).toHaveBeenCalledWith(JSON.stringify(validateResponse, null, 2));
});

test('validate_schema sends an explicit null payload', async () => {
  replies = [validateResponse];
  await run('validate_schema', '--schema', '{"type":"object"}', '--payload', 'null');
  expect(requests[0]).toEqual({
    path: '/utils/validate_schema',
    options: {
      method: 'POST',
      body: { schema: { type: 'object' }, payload: null },
    },
  });
});

test('validate_schema reads schema and payload files as JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prefactor-utils-'));
  const schemaPath = join(dir, 'schema.json');
  const payloadPath = join(dir, 'payload.json');
  await writeFile(schemaPath, '{"type":"object"}');
  await writeFile(payloadPath, '{"name":"Ada"}');
  replies = [validateResponse];
  await run('validate_schema', '--schema', `@${schemaPath}`, '--payload', `@${payloadPath}`);
  expect(requests[0]).toEqual({
    path: '/utils/validate_schema',
    options: {
      method: 'POST',
      body: {
        schema: { type: 'object' },
        payload: { name: 'Ada' },
      },
    },
  });
});

test('validate_schema rejects a schema that is not an object', async () => {
  await expect(run('validate_schema', '--schema', 'null')).rejects.toThrow(
    '--schema must be a JSON object.'
  );
  expect(requests).toEqual([]);
});

test('process_sensitive_payload sends the payload and omits schema', async () => {
  replies = [response];
  await run('process_sensitive_payload', '--payload', '{"email":"a@example.com"}');
  expect(requests).toEqual([
    {
      path: '/utils/process_sensitive_payload',
      options: {
        method: 'POST',
        body: { payload: { email: 'a@example.com' } },
      },
    },
  ]);
  expect(log).toHaveBeenCalledWith(JSON.stringify(response, null, 2));
});

test('process_sensitive_payload sends an explicit null schema', async () => {
  replies = [{ ...response, payload_valid: null }];
  await run(
    'process_sensitive_payload',
    '--payload',
    '{"email":"a@example.com"}',
    '--schema',
    'null'
  );
  expect(requests[0]).toEqual({
    path: '/utils/process_sensitive_payload',
    options: {
      method: 'POST',
      body: { payload: { email: 'a@example.com' }, schema: null },
    },
  });
});

test('process_sensitive_payload reads payload and schema files as JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prefactor-utils-'));
  const payloadPath = join(dir, 'payload.json');
  const schemaPath = join(dir, 'schema.json');
  await writeFile(payloadPath, '{"email":"a@example.com"}');
  await writeFile(schemaPath, '{"type":"object"}');
  replies = [response];
  await run(
    'process_sensitive_payload',
    '--payload',
    `@${payloadPath}`,
    '--schema',
    `@${schemaPath}`
  );
  expect(requests[0]).toEqual({
    path: '/utils/process_sensitive_payload',
    options: {
      method: 'POST',
      body: {
        payload: { email: 'a@example.com' },
        schema: { type: 'object' },
      },
    },
  });
});

test('process_sensitive_payload rejects a payload that is not an object', async () => {
  await expect(run('process_sensitive_payload', '--payload', '["email"]')).rejects.toThrow(
    '--payload must be a JSON object.'
  );
  expect(requests).toEqual([]);
});
