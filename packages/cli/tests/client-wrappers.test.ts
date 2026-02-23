import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ApiClient } from '../src/api-client.js';
import { AccountClient } from '../src/clients/account.js';
import { AdminUserClient } from '../src/clients/admin-user.js';
import { AdminUserInviteClient } from '../src/clients/admin-user-invite.js';
import { AgentClient } from '../src/clients/agent.js';
import { AgentInstanceClient } from '../src/clients/agent-instance.js';
import { AgentSchemaVersionClient } from '../src/clients/agent-schema-version.js';
import { AgentSpanClient } from '../src/clients/agent-span.js';
import { AgentVersionClient } from '../src/clients/agent-version.js';
import { ApiTokenClient } from '../src/clients/api-token.js';
import { BulkClient } from '../src/clients/bulk.js';
import { EnvironmentClient } from '../src/clients/environment.js';
import { PfidClient } from '../src/clients/pfid.js';
import * as cliExports from '../src/index.js';

type CapturedRequest = {
  url: string;
  init?: RequestInit;
};

describe('resource clients', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('root index exports all clients', () => {
    expect(typeof cliExports.AccountClient).toBe('function');
    expect(typeof cliExports.AgentClient).toBe('function');
    expect(typeof cliExports.EnvironmentClient).toBe('function');
    expect(typeof cliExports.AgentVersionClient).toBe('function');
    expect(typeof cliExports.AgentSchemaVersionClient).toBe('function');
    expect(typeof cliExports.AgentInstanceClient).toBe('function');
    expect(typeof cliExports.AgentSpanClient).toBe('function');
    expect(typeof cliExports.AdminUserClient).toBe('function');
    expect(typeof cliExports.AdminUserInviteClient).toBe('function');
    expect(typeof cliExports.ApiTokenClient).toBe('function');
    expect(typeof cliExports.PfidClient).toBe('function');
    expect(typeof cliExports.BulkClient).toBe('function');
  });

  test('agent list uses query filters for GET', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentClient(apiClient);

    await client.list('env_123');

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent');
    expect(url.searchParams.get('environment_id')).toBe('env_123');
    expect(captured?.init?.method).toBe('GET');
    expect(captured?.init?.body).toBeUndefined();
  });

  test('environment create wraps payload in details', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'env_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new EnvironmentClient(apiClient);

    await client.create({ account_id: 'acct_123', name: 'Production' });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/environment');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe('{"details":{"account_id":"acct_123","name":"Production"}}');
  });

  test('agent span finish sends action payload without details wrapper', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'span_123' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentSpanClient(apiClient);

    const response = await client.finish('span_123', { status: 'finished' });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe(
      '/api/v1/agent_spans/span_123/finish'
    );
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe('{"status":"finished"}');
    expect(response).toEqual({ details: { id: 'span_123' } });
  });

  test('api token activate posts empty action body', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'tok_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new ApiTokenClient(apiClient);

    await client.activate('tok_1');

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe(
      '/api/v1/api_token/tok_1/activate'
    );
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe('{}');
  });

  test('pfid generate sends non-details payload', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { pfids: ['pfid_1'] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new PfidClient(apiClient);

    await client.generate(3, 'acct_123');

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/pfid/generate');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe('{"count":3,"account_id":"acct_123"}');
  });

  test('bulk execute sends items as top-level body key', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { items: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new BulkClient(apiClient);

    await client.execute([{ method: 'GET', path: '/account' }]);

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/bulk');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe('{"items":[{"method":"GET","path":"/account"}]}');
  });

  test('covers additional wrapper request shapes', async () => {
    const calls: CapturedRequest[] = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ details: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const accountClient = new AccountClient(apiClient);
    const adminUserClient = new AdminUserClient(apiClient);
    const adminUserInviteClient = new AdminUserInviteClient(apiClient);
    const agentVersionClient = new AgentVersionClient(apiClient);
    const agentSchemaVersionClient = new AgentSchemaVersionClient(apiClient);
    const agentInstanceClient = new AgentInstanceClient(apiClient);

    await accountClient.update('acct_1', { name: 'Renamed' });
    await adminUserClient.list('acct_1');
    await adminUserInviteClient.create('user@example.com', 'acct_1');
    await agentVersionClient.create('agent_1', 'v1');
    await agentSchemaVersionClient.create('agent_1', 'schema_v1', {
      span_schemas: { root: { type: 'object' } },
    });
    await agentInstanceClient.register({
      agent_id: 'agent_1',
      agent_version: { external_identifier: 'v1', name: 'Agent' },
      agent_schema_version: { external_identifier: 'schema_v1' },
    });

    const checks: Array<{
      index: number;
      path: string;
      method: string;
      body?: string;
      query?: Array<[string, string]>;
    }> = [
      {
        index: 0,
        path: '/api/v1/account/acct_1',
        method: 'PUT',
        body: '{"details":{"name":"Renamed"}}',
      },
      {
        index: 1,
        path: '/api/v1/admin_user',
        method: 'GET',
        query: [['account_id', 'acct_1']],
      },
      {
        index: 2,
        path: '/api/v1/admin_user_invite',
        method: 'POST',
        body: '{"details":{"email":"user@example.com","account_id":"acct_1"}}',
      },
      {
        index: 3,
        path: '/api/v1/agent_version',
        method: 'POST',
        body: '{"details":{"agent_id":"agent_1","external_identifier":"v1"}}',
      },
      {
        index: 4,
        path: '/api/v1/agent_schema_version',
        method: 'POST',
        body: '{"details":{"agent_id":"agent_1","external_identifier":"schema_v1","span_schemas":{"root":{"type":"object"}}}}',
      },
      {
        index: 5,
        path: '/api/v1/agent_instance/register',
        method: 'POST',
        body: '{"agent_id":"agent_1","agent_version":{"external_identifier":"v1","name":"Agent"},"agent_schema_version":{"external_identifier":"schema_v1"}}',
      },
    ];

    for (const check of checks) {
      const call = calls[check.index];
      expect(call).toBeDefined();
      const url = new URL(call?.url ?? 'https://example.com');
      expect(url.pathname).toBe(check.path);
      expect(call?.init?.method).toBe(check.method);
      if (check.body) {
        expect(call?.init?.body).toBe(check.body);
      } else {
        expect(call?.init?.body).toBeUndefined();
      }

      if (check.query) {
        for (const [key, value] of check.query) {
          expect(url.searchParams.get(key)).toBe(value);
        }
      }
    }
  });
});
