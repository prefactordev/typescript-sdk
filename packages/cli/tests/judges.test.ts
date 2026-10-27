import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiClient } from '../src/api-client.js';
import { createCli } from '../src/cli.js';
import { ProfileManager } from '../src/profile-manager.js';

const response = { details: { id: 'agent_1' }, status: 'success' };
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

async function run(group: string, ...args: string[]): Promise<void> {
  await createCli('test')
    .exitOverride()
    .parseAsync([group, ...args], { from: 'user' });
}

test('judges list asks for the judge role', async () => {
  replies = [{ summaries: [], status: 'success' }];
  await run('judges', 'list');
  expect(requests).toEqual([
    { path: '/agent', options: { method: 'GET', query: { role: 'judge' } } },
  ]);
});

test('judges create sends role judge and the hosted execution mode', async () => {
  replies = [response];
  await run('judges', 'create', '--name', 'Completion judge', '--description', 'Scores runs');
  expect(requests).toEqual([
    {
      path: '/agent',
      options: {
        method: 'POST',
        body: {
          details: {
            name: 'Completion judge',
            description: 'Scores runs',
            role: 'judge',
            execution_mode: 'hosted',
          },
        },
      },
    },
  ]);
});

test('create_version reads criterion and template files as text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'judge-'));
  const criterion = join(dir, 'criterion.md');
  const template = join(dir, 'template.liquid');
  writeFileSync(criterion, 'Score the run.\n');
  writeFileSync(template, 'Criterion: {{ criterion }}');
  replies = [response];
  try {
    await run(
      'judges',
      'create_version',
      '--agent_id',
      'judge_1',
      '--hosted_llm_provider_model_id',
      'model_1',
      '--criterion',
      `@${criterion}`,
      '--system_prompt_template',
      `@${template}`,
      '--external_identifier',
      'judge-v1'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(requests).toEqual([
    {
      path: '/agent_version/hosted_judge',
      options: {
        method: 'POST',
        body: {
          details: {
            agent_id: 'judge_1',
            hosted_llm_provider_model_id: 'model_1',
            criterion: 'Score the run.\n',
            external_identifier: 'judge-v1',
            system_prompt_template: 'Criterion: {{ criterion }}',
          },
        },
      },
    },
  ]);
});

test('templates lists the built-in judge templates', async () => {
  replies = [{ templates: [], default_system_prompt_template: 'default', status: 'success' }];
  await run('judges', 'templates');
  expect(requests).toEqual([
    { path: '/agent_version/judge_templates', options: { method: 'GET' } },
  ]);
  expect(log).toHaveBeenCalled();
});

test('score posts the judge agent id for an instance', async () => {
  replies = [response];
  await run('judges', 'score', 'instance_1', '--judge_agent_id', 'judge_1');
  expect(requests).toEqual([
    {
      path: '/agent_instance/instance_1/judge',
      options: { method: 'POST', body: { judge_agent_id: 'judge_1' } },
    },
  ]);
});

test('agent association create sends the trigger and endpoints', async () => {
  replies = [response];
  await run(
    'agent_associations',
    'create',
    '--from_agent_id',
    'judge_1',
    '--to_agent_id',
    'agent_1',
    '--association_type',
    'judge',
    '--trigger',
    'on_completion'
  );
  expect(requests).toEqual([
    {
      path: '/agent_association',
      options: {
        method: 'POST',
        body: {
          details: {
            from_agent_id: 'judge_1',
            to_agent_id: 'agent_1',
            association_type: 'judge',
            trigger: 'on_completion',
          },
        },
      },
    },
  ]);
});

test('judges update sends an empty description', async () => {
  replies = [response];
  await run('judges', 'update', 'judge_1', '--description', '');
  expect(requests).toEqual([
    {
      path: '/agent/judge_1',
      options: {
        method: 'PUT',
        body: { details: { description: '' } },
      },
    },
  ]);
});

test('agent association list sends desc sorting as -field and bracketed pagination', async () => {
  replies = [{ summaries: [], status: 'success' }];
  await run(
    'agent_associations',
    'list_from',
    '--agent_id',
    'judge_1',
    '--sort_field',
    'id',
    '--sort_direction',
    'desc',
    '--pagination_offset',
    '0',
    '--pagination_page_size',
    '25'
  );
  expect(requests).toEqual([
    {
      path: '/agent_association/from',
      options: {
        method: 'GET',
        query: {
          agent_id: 'judge_1',
          sorting: '-id',
          'pagination[offset]': 0,
          'pagination[page_size]': 25,
        },
      },
    },
  ]);
});

test('instance association list_from sends the instance ids', async () => {
  replies = [{ summaries: [], status: 'success' }];
  await run(
    'agent_instance_associations',
    'list_from',
    '--agent_instance_ids',
    'instance_1, instance_2'
  );
  expect(requests).toEqual([
    {
      path: '/agent_instance_association/from',
      options: {
        method: 'GET',
        query: { agent_instance_ids: ['instance_1', 'instance_2'] },
      },
    },
  ]);
});
