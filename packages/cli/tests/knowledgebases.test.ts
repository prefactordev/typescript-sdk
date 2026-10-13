import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiClient } from '../src/api-client.js';
import { createCli } from '../src/cli.js';
import { ProfileManager } from '../src/profile-manager.js';

const response = { details: { id: 'kb_1', content: 'raw text' }, status: 'success' };
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

test('knowledgebases list sends filters, sorting, and pagination', async () => {
  replies = [{ summaries: [], status: 'success' }];
  await run(
    'knowledgebases',
    'list',
    '--account_id',
    'acct_1',
    '--status',
    'archived',
    '--sort_field',
    'name',
    '--sort_direction',
    'desc',
    '--pagination_offset',
    '10',
    '--pagination_page_size',
    '5'
  );
  expect(requests).toEqual([
    {
      path: '/knowledgebase',
      options: {
        method: 'GET',
        query: {
          account_id: 'acct_1',
          status: 'archived',
          'sorting[field]': 'name',
          'sorting[direction]': 'desc',
          'pagination[offset]': 10,
          'pagination[page_size]': 5,
        },
      },
    },
  ]);
});

test('knowledgebases list defaults sort direction to asc', async () => {
  replies = [{ summaries: [], status: 'success' }];
  await run('knowledgebases', 'list', '--sort_field', 'name');
  expect(requests[0]).toEqual({
    path: '/knowledgebase',
    options: {
      method: 'GET',
      query: {
        'sorting[field]': 'name',
        'sorting[direction]': 'asc',
      },
    },
  });
});

test('sort direction without a sort field is rejected', async () => {
  await expect(run('knowledgebases', 'list', '--sort_direction', 'desc')).rejects.toThrow(
    '--sort_direction requires --sort_field.'
  );
  expect(requests).toEqual([]);
});

test('knowledgebases create sends the details envelope', async () => {
  replies = [response];
  await run(
    'knowledgebases',
    'create',
    '--name',
    'Support docs',
    '--account_id',
    'acct_1',
    '--description',
    'Guides'
  );
  expect(requests).toEqual([
    {
      path: '/knowledgebase',
      options: {
        method: 'POST',
        body: {
          details: { name: 'Support docs', account_id: 'acct_1', description: 'Guides' },
        },
      },
    },
  ]);
  expect(log).toHaveBeenCalledWith(JSON.stringify(response, null, 2));
});

test('knowledgebases update can clear the description', async () => {
  replies = [response];
  await run('knowledgebases', 'update', 'kb_1', '--clear_description');
  expect(requests).toEqual([
    {
      path: '/knowledgebase/kb_1',
      options: { method: 'PUT', body: { details: { description: null } } },
    },
  ]);
});

test('knowledgebases update rejects an empty change', async () => {
  await expect(run('knowledgebases', 'update', 'kb_1')).rejects.toThrow(
    'No fields provided to update. Specify --name, --description, or --clear_description.'
  );
  expect(requests).toEqual([]);
});

test('description and clear_description cannot be combined', async () => {
  await expect(
    run('knowledgebases', 'update', 'kb_1', '--description', 'Guides', '--clear_description')
  ).rejects.toThrow('Use only one of --description or --clear_description.');
  expect(requests).toEqual([]);
});

for (const [command, method, suffix] of [
  ['retrieve', 'GET', ''],
  ['archive', 'POST', '/archive'],
  ['unarchive', 'POST', '/unarchive'],
  ['delete', 'DELETE', ''],
] as const) {
  test(`knowledgebases ${command} calls the knowledgebase endpoint`, async () => {
    replies = [response];
    await run('knowledgebases', command, 'kb_1');
    expect(requests).toEqual([{ path: `/knowledgebase/kb_1${suffix}`, options: { method } }]);
  });
}

test('document create reads @file content as text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-'));
  const file = join(dir, 'guide.md');
  writeFileSync(file, '{"not":"parsed"}\n');
  replies = [response];
  try {
    await run(
      'knowledgebase_documents',
      'create',
      '--knowledgebase_id',
      'kb_1',
      '--path',
      'guide.md',
      '--content',
      `@${file}`,
      '--content_type',
      'text/markdown'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(requests).toEqual([
    {
      path: '/knowledgebase_document',
      options: {
        method: 'POST',
        body: {
          details: {
            knowledgebase_id: 'kb_1',
            path: 'guide.md',
            content: '{"not":"parsed"}\n',
            content_type: 'text/markdown',
          },
        },
      },
    },
  ]);
});

test('document retrieve --content_only prints the content string', async () => {
  const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
  replies = [{ details: { content: 'raw text' }, status: 'success' }];
  try {
    await run('knowledgebase_documents', 'retrieve', 'doc_1', '--content_only');
    expect(requests).toEqual([
      { path: '/knowledgebase_document/doc_1', options: { method: 'GET' } },
    ]);
    expect(write).toHaveBeenCalledWith('raw text');
    expect(log).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
  }
});

test('document retrieve --content_only fails when content is missing', async () => {
  replies = [{ details: {}, status: 'success' }];
  await expect(
    run('knowledgebase_documents', 'retrieve', 'doc_1', '--content_only')
  ).rejects.toThrow('Response is missing document content.');
});

test('document update sends base_revision_id beside the details', async () => {
  replies = [response];
  await run(
    'knowledgebase_documents',
    'update',
    'doc_1',
    '--base_revision_id',
    'rev_1',
    '--content',
    'next'
  );
  expect(requests).toEqual([
    {
      path: '/knowledgebase_document/doc_1',
      options: {
        method: 'PUT',
        body: { base_revision_id: 'rev_1', details: { content: 'next' } },
      },
    },
  ]);
});

test('document update rejects an empty change', async () => {
  await expect(
    run('knowledgebase_documents', 'update', 'doc_1', '--base_revision_id', 'rev_1')
  ).rejects.toThrow('No fields provided to update. Specify --content or --content_type.');
  expect(requests).toEqual([]);
});

test('document archive requires a base revision id', async () => {
  // Commander exits the process for a missing required option on a subcommand.
  const exit = spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit');
  });
  const writeErr = spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await expect(run('knowledgebase_documents', 'archive', 'doc_1')).rejects.toThrow('exit');
    expect(requests).toEqual([]);
  } finally {
    exit.mockRestore();
    writeErr.mockRestore();
  }
});

test('document archive sends the base revision id', async () => {
  replies = [response];
  await run('knowledgebase_documents', 'archive', 'doc_1', '--base_revision_id', 'rev_1');
  expect(requests).toEqual([
    {
      path: '/knowledgebase_document/doc_1/archive',
      options: { method: 'POST', body: { base_revision_id: 'rev_1' } },
    },
  ]);
});

test('document unarchive can include a restored path', async () => {
  replies = [response];
  await run(
    'knowledgebase_documents',
    'unarchive',
    'doc_1',
    '--base_revision_id',
    'rev_1',
    '--path',
    'guide.md'
  );
  expect(requests).toEqual([
    {
      path: '/knowledgebase_document/doc_1/unarchive',
      options: { method: 'POST', body: { base_revision_id: 'rev_1', path: 'guide.md' } },
    },
  ]);
});

test('document revision retrieve --content_only prints revision content', async () => {
  const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
  replies = [{ details: { content: 'old text' }, status: 'success' }];
  try {
    await run('knowledgebase_document_revisions', 'retrieve', 'drev_1', '--content_only');
    expect(requests).toEqual([
      { path: '/knowledgebase_document_revision/drev_1', options: { method: 'GET' } },
    ]);
    expect(write).toHaveBeenCalledWith('old text');
    expect(log).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
  }
});

test('knowledgebase revision list_documents sends the path prefix and pagination', async () => {
  replies = [{ summaries: [], status: 'success' }];
  await run(
    'knowledgebase_revisions',
    'list_documents',
    'krev_1',
    '--path_prefix',
    'guides/',
    '--pagination_offset',
    '0',
    '--pagination_page_size',
    '20'
  );
  expect(requests).toEqual([
    {
      path: '/knowledgebase_revision/krev_1/documents',
      options: {
        method: 'GET',
        query: {
          path_prefix: 'guides/',
          'pagination[offset]': 0,
          'pagination[page_size]': 20,
        },
      },
    },
  ]);
});
