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
    '--agent_ids',
    'judge_1, judge_2',
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
          agent_ids: ['judge_1', 'judge_2'],
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

test('judges create sends the team and owner', async () => {
  replies = [response];
  await run(
    'judges',
    'create',
    '--name',
    'Tone judge',
    '--team_id',
    'team_1',
    '--owner_person_id',
    'person_1'
  );
  expect(requests).toEqual([
    {
      path: '/agent',
      options: {
        method: 'POST',
        body: {
          details: {
            name: 'Tone judge',
            role: 'judge',
            execution_mode: 'hosted',
            team_id: 'team_1',
            owner_person_id: 'person_1',
          },
        },
      },
    },
  ]);
});

test('judges update sends the team and owner', async () => {
  replies = [response];
  await run('judges', 'update', 'judge_1', '--team_id', 'team_1', '--owner_person_id', 'person_1');
  expect(requests).toEqual([
    {
      path: '/agent/judge_1',
      options: {
        method: 'PUT',
        body: { details: { team_id: 'team_1', owner_person_id: 'person_1' } },
      },
    },
  ]);
});

test('agent_deployments list_promotions asks for the agent', async () => {
  replies = [{ promotions: [], status: 'success' }];
  await run('agent_deployments', 'list_promotions', '--agent_id', 'judge_1');
  expect(requests).toEqual([
    {
      path: '/agent_deployment/promotions',
      options: { method: 'GET', query: { agent_id: 'judge_1' } },
    },
  ]);
});

test('agent_deployments promote posts to the deployment', async () => {
  replies = [response];
  await run('agent_deployments', 'promote', 'deployment_1');
  expect(requests).toEqual([
    {
      path: '/agent_deployment/deployment_1/promote',
      options: { method: 'POST', body: {} },
    },
  ]);
});

test('agent_instances list filters by status', async () => {
  replies = [{ summaries: [], status: 'success' }];
  await run('agent_instances', 'list', '--agent_id', 'judge_1', '--statuses', 'pending, active');
  expect(requests).toEqual([
    {
      path: '/agent_instance',
      options: {
        method: 'GET',
        query: { agent_id: 'judge_1', statuses: ['pending', 'active'] },
      },
    },
  ]);
});

test('agent_instances list rejects an unknown status', async () => {
  await expect(
    run('agent_instances', 'list', '--agent_id', 'judge_1', '--statuses', 'done')
  ).rejects.toThrow('--statuses');
  expect(requests).toEqual([]);
});

test('agent_instances prepare sends the input', async () => {
  replies = [response];
  await run('agent_instances', 'prepare', 'instance_1', '--params_payload', '{"message":"Run"}');
  expect(requests).toEqual([
    {
      path: '/agent_instance/instance_1/prepare',
      options: { method: 'POST', body: { params_payload: { message: 'Run' } } },
    },
  ]);
});

test('agent_instances discard_sensitive posts to the instance', async () => {
  replies = [response];
  await run('agent_instances', 'discard_sensitive', 'instance_1');
  expect(requests).toEqual([
    {
      path: '/agent_instance/instance_1/discard_sensitive',
      options: { method: 'POST', body: {} },
    },
  ]);
});

test('agent_instances record_quality sends the name and payload', async () => {
  replies = [response];
  await run(
    'agent_instances',
    'record_quality',
    'instance_1',
    '--name',
    'summary_quality',
    '--payload',
    '{"score":88}'
  );
  expect(requests).toEqual([
    {
      path: '/api/v1/agent_instance/instance_1/record_quality',
      options: {
        method: 'POST',
        body: {
          name: 'summary_quality',
          payload: { score: 88 },
          idempotency_key: expect.any(String),
        },
      },
    },
  ]);
});

test('agent_instances finish sends the result payload', async () => {
  replies = [response];
  await run(
    'agent_instances',
    'finish',
    'instance_1',
    '--status',
    'complete',
    '--result_payload',
    '{"verdict":"pass","explanation":"Answered."}'
  );
  expect(requests).toEqual([
    {
      path: '/api/v1/agent_instance/instance_1/finish',
      options: {
        method: 'POST',
        body: {
          status: 'complete',
          result_payload: { verdict: 'pass', explanation: 'Answered.' },
          idempotency_key: expect.any(String),
        },
      },
    },
  ]);
});

test('agent_instances register sends instance schemas, input, and metadata', async () => {
  replies = [response];
  await run(
    'agent_instances',
    'register',
    '--agent_id',
    'agent_1',
    '--environment_id',
    'env_1',
    '--purpose',
    'eval',
    '--agent_version_external_identifier',
    'v1',
    '--agent_version_name',
    'v1',
    '--agent_schema_version_external_identifier',
    'schema-1',
    '--instance_params_payload_schema',
    '{"schema":{"type":"object"}}',
    '--instance_result_payload_schema',
    '{"title":"Outcome","schema":{"type":"object"}}',
    '--instance_metadata_schema',
    '{"schema":{"type":"object"},"template":"{{trigger}}"}',
    '--params_payload',
    '{"ticket_id":"T-1"}',
    '--metadata',
    '{"trigger":"inbox"}'
  );
  expect(requests).toEqual([
    {
      path: '/api/v1/agent_instance/register',
      options: {
        method: 'POST',
        body: {
          agent_id: 'agent_1',
          environment_id: 'env_1',
          purpose: 'eval',
          agent_version: { external_identifier: 'v1', name: 'v1' },
          agent_schema_version: {
            external_identifier: 'schema-1',
            instance_params_payload_schema: { schema: { type: 'object' } },
            instance_result_payload_schema: { title: 'Outcome', schema: { type: 'object' } },
            instance_metadata_schema: { schema: { type: 'object' }, template: '{{trigger}}' },
          },
          params_payload: { ticket_id: 'T-1' },
          metadata: { trigger: 'inbox' },
          idempotency_key: expect.any(String),
        },
      },
    },
  ]);
});

test('agent_schema_versions create sends instance payload schemas', async () => {
  replies = [response];
  await run(
    'agent_schema_versions',
    'create',
    '--agent_id',
    'judge_1',
    '--external_identifier',
    'remote-judge-1',
    '--instance_params_payload_schema',
    '{"schema":{"type":"object"}}',
    '--instance_result_payload_schema',
    '{"title":"Judgement","schema":{"type":"object"}}'
  );
  expect(requests).toEqual([
    {
      path: '/agent_schema_version',
      options: {
        method: 'POST',
        body: {
          details: {
            agent_id: 'judge_1',
            external_identifier: 'remote-judge-1',
            instance_params_payload_schema: { schema: { type: 'object' } },
            instance_result_payload_schema: { title: 'Judgement', schema: { type: 'object' } },
          },
        },
      },
    },
  ]);
});

test('agent_versions create links a schema version and execution mode', async () => {
  replies = [response];
  await run(
    'agent_versions',
    'create',
    '--agent_id',
    'judge_1',
    '--external_identifier',
    'remote-judge-1',
    '--agent_schema_version_id',
    'schema_1',
    '--execution_mode',
    'remote'
  );
  expect(requests).toEqual([
    {
      path: '/agent_version',
      options: {
        method: 'POST',
        body: {
          details: {
            agent_id: 'judge_1',
            external_identifier: 'remote-judge-1',
            agent_schema_version_id: 'schema_1',
            execution_mode: 'remote',
          },
        },
      },
    },
  ]);
});
