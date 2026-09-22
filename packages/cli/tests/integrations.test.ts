import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { ApiClient } from '../src/api-client.js';
import { createCli } from '../src/cli.js';
import { ProfileManager } from '../src/profile-manager.js';

const summary = {
  id: 'integration-1',
  type: 'account_integration',
  integration_type: 'slack',
  status: 'active',
};
const redacted = { $sensitive: 'string', labels: ['authentication_and_secrets'] };
const details = { ...summary, config: { _version: 1, webhook_url: redacted, enabled_events: [] } };
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
    .parseAsync(['integrations', ...args], { from: 'user' });
}

test('lists integrations and prints the API response', async () => {
  const response = { summaries: [summary], status: 'success' };
  replies = [response];
  await run('list');
  expect(requests).toEqual([{ path: '/account_integration', options: { method: 'GET' } }]);
  expect(log).toHaveBeenCalledWith(JSON.stringify(response, null, 2));
});

for (const [command, method, suffix, response] of [
  ['retrieve', 'GET', '', { details, status: 'success' }],
  ['delete', 'DELETE', '', { details, status: 'success' }],
  ['test', 'POST', '/test', { delivered: true, status: 'success' }],
] as const) {
  test(`${command} resolves the type to an ID and prints its result`, async () => {
    replies = [{ summaries: [summary], status: 'success' }, response];
    await run(command, 'slack');
    expect(requests).toEqual([
      { path: '/account_integration', options: { method: 'GET' } },
      { path: `/account_integration/integration-1${suffix}`, options: { method } },
    ]);
    expect(log).toHaveBeenCalledWith(JSON.stringify(response, null, 2));
  });
}

for (const exists of [false, true]) {
  test(`update ${exists ? 'replaces' : 'creates'} the Slack config`, async () => {
    replies = [
      { summaries: exists ? [summary] : [], status: 'success' },
      { details, status: 'success' },
    ];
    await run(
      'update',
      'slack',
      '--webhook_url',
      'https://hooks.slack.com/services/test',
      '--enabled_events',
      'agent_created,alert_raised'
    );
    const config = {
      _version: 1,
      webhook_url: 'https://hooks.slack.com/services/test',
      enabled_events: ['agent_created', 'alert_raised'],
    };
    expect(requests).toEqual([
      { path: '/account_integration', options: { method: 'GET' } },
      {
        path: exists ? '/account_integration/integration-1' : '/account_integration',
        options: {
          method: exists ? 'PUT' : 'POST',
          body: {
            details: exists ? { config } : { integration_type: 'slack', status: 'active', config },
          },
        },
      },
    ]);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ details, status: 'success' }, null, 2));
  });
}

test('an empty event selection disables all events', async () => {
  replies = [
    { summaries: [summary], status: 'success' },
    { details, status: 'success' },
  ];
  await run(
    'update',
    'slack',
    '--webhook_url',
    'https://hooks.slack.com/services/test',
    '--enabled_events',
    ''
  );
  expect(requests[1]).toEqual({
    path: '/account_integration/integration-1',
    options: {
      method: 'PUT',
      body: {
        details: {
          config: {
            _version: 1,
            webhook_url: 'https://hooks.slack.com/services/test',
            enabled_events: [],
          },
        },
      },
    },
  });
});

test('missing integration does not issue a mutation', async () => {
  replies = [{ summaries: [], status: 'success' }];
  await expect(run('delete', 'slack')).rejects.toThrow("Integration 'slack' is not configured.");
  expect(requests).toEqual([{ path: '/account_integration', options: { method: 'GET' } }]);
});

test('list failures do not become create requests', async () => {
  replies = [new Error('Access denied')];
  await expect(
    run(
      'update',
      'slack',
      '--webhook_url',
      'https://hooks.slack.com/services/test',
      '--enabled_events',
      'agent_created'
    )
  ).rejects.toThrow('Access denied');
  expect(requests).toEqual([{ path: '/account_integration', options: { method: 'GET' } }]);
});

test('test delivery errors propagate without a success result', async () => {
  replies = [
    { summaries: [summary], status: 'success' },
    new Error('Slack webhook returned status 400'),
  ];
  await expect(run('test', 'slack')).rejects.toThrow('Slack webhook returned status 400');
  expect(log.mock.calls).toEqual([]);
});

test('test delivery false results fail without printing success', async () => {
  replies = [
    { summaries: [summary], status: 'success' },
    { delivered: false, status: 'success' },
  ];
  await expect(run('test', 'slack')).rejects.toThrow(
    "Integration 'slack' test notification was not delivered."
  );
  expect(log.mock.calls).toEqual([]);
});
