import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AgentInstanceClient as CoreAgentInstanceClient } from '@prefactor/core';
import { ApiClient } from '../src/api-client.js';
import { AccountClient } from '../src/clients/account.js';
import { AdminUserClient } from '../src/clients/admin-user.js';
import { AdminUserInviteClient } from '../src/clients/admin-user-invite.js';
import { AgentClient } from '../src/clients/agent.js';
import { AgentDeploymentClient } from '../src/clients/agent-deployment.js';
import { AgentInstanceClient, showAgentInstance } from '../src/clients/agent-instance.js';
import { AgentSchemaVersionClient } from '../src/clients/agent-schema-version.js';
import { AgentSpanClient } from '../src/clients/agent-span.js';
import { AgentVersionClient } from '../src/clients/agent-version.js';
import { AlertClient } from '../src/clients/alert.js';
import { ApiTokenClient } from '../src/clients/api-token.js';
import { BulkClient } from '../src/clients/bulk.js';
import { EnvironmentClient } from '../src/clients/environment.js';
import { PersonClient } from '../src/clients/person.js';
import { PfidClient } from '../src/clients/pfid.js';
import { RiskProfileClient, type RiskProfileRuleset } from '../src/clients/risk-profile.js';
import { TeamClient } from '../src/clients/team.js';
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
    expect(typeof cliExports.AgentDeploymentClient).toBe('function');
    expect(typeof cliExports.EnvironmentClient).toBe('function');
    expect(typeof cliExports.AgentVersionClient).toBe('function');
    expect(typeof cliExports.AgentSchemaVersionClient).toBe('function');
    expect(typeof cliExports.AgentInstanceClient).toBe('function');
    expect(typeof cliExports.AgentSpanClient).toBe('function');
    expect(typeof cliExports.AlertClient).toBe('function');
    expect(typeof cliExports.PersonClient).toBe('function');
    expect(typeof cliExports.TeamClient).toBe('function');
    expect(typeof cliExports.RiskProfileClient).toBe('function');
    expect(typeof cliExports.AdminUserClient).toBe('function');
    expect(typeof cliExports.AdminUserInviteClient).toBe('function');
    expect(typeof cliExports.ApiTokenClient).toBe('function');
    expect(typeof cliExports.PfidClient).toBe('function');
    expect(typeof cliExports.BulkClient).toBe('function');
    expect(cliExports.AgentInstanceClient).toBe(CoreAgentInstanceClient);
  });

  test('agent list sends GET without filters', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentClient(apiClient);

    const response = await client.list();

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent');
    expect(url.searchParams.toString()).toBe('');
    expect(captured?.init?.method).toBe('GET');
    expect(captured?.init?.body).toBeUndefined();
    expect(response).toEqual({ summaries: [] });
  });

  test('agent show sends lookup query params', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'agent_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentClient(apiClient);

    await client.show({
      agent_id: 'agent_1',
      include_counts: true,
      include_risk_rollup: true,
    });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent/show');
    expect(url.searchParams.get('agent_id')).toBe('agent_1');
    expect(url.searchParams.get('include_counts')).toBe('true');
    expect(url.searchParams.get('include_risk_rollup')).toBe('true');
    expect(captured?.init?.method).toBe('GET');
  });

  test('agent deployment list uses agent_id query param', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentDeploymentClient(apiClient);

    const response = await client.list('agent_123');

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent_deployment');
    expect(url.searchParams.get('agent_id')).toBe('agent_123');
    expect(captured?.init?.method).toBe('GET');
    expect(response).toEqual({ summaries: [] });
  });

  test('agent deployment create wraps payload in details', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'dep_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentDeploymentClient(apiClient);

    await client.create({ agent_id: 'agent_1', environment_id: 'env_1' });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent_deployment');
    expect(captured?.init?.method).toBe('POST');
    const body = JSON.parse(String(captured?.init?.body));
    expect(body.details.agent_id).toBe('agent_1');
    expect(body.details.environment_id).toBe('env_1');
  });

  test('agent deployment update sends PUT with details', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'dep_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentDeploymentClient(apiClient);

    await client.update('dep_1', { current_version_id: 'ver_1' });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent_deployment/dep_1');
    expect(captured?.init?.method).toBe('PUT');
    const body = JSON.parse(String(captured?.init?.body));
    expect(body.details.current_version_id).toBe('ver_1');
  });

  test('agent deployment update supports clearing current_version_id', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'dep_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentDeploymentClient(apiClient);

    await client.update('dep_1', { current_version_id: null });

    const body = JSON.parse(String(captured?.init?.body));
    expect(body.details.current_version_id).toBeNull();
  });

  test('agent deployment delete sends DELETE', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'dep_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentDeploymentClient(apiClient);

    await client.delete('dep_1');

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent_deployment/dep_1');
    expect(captured?.init?.method).toBe('DELETE');
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

  test('environment show sends lookup query params', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'env_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new EnvironmentClient(apiClient);

    await client.show({ environment_id: 'env_1' });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/environment/show');
    expect(url.searchParams.get('environment_id')).toBe('env_1');
    expect(captured?.init?.method).toBe('GET');
  });

  test('agent instance show sends lookup query params', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(
        JSON.stringify({ details: { id: 'agent_instance_1' }, status: 'success' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');

    await showAgentInstance(apiClient, {
      agent_instance_id: 'agent_instance_1',
      include_counts: true,
      include_costs: true,
    });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent_instance/show');
    expect(url.searchParams.get('agent_instance_id')).toBe('agent_instance_1');
    expect(url.searchParams.get('include_counts')).toBe('true');
    expect(url.searchParams.get('include_costs')).toBe('true');
    expect(captured?.init?.method).toBe('GET');
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

  test('agent span retrieve sends GET with optional redacted query', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(
        JSON.stringify({
          details: {
            id: 'span_123',
            agent_instance_id: 'agent_instance_1',
            schema_name: 'llm',
            status: 'complete',
            purpose: 'activity',
            schema_title: 'LLM call',
            summary: 'gpt-4 completed',
            payload_byte_size_estimate: 128,
            data_risk: null,
          },
          status: 'success',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentSpanClient(apiClient);

    const response = await client.retrieve('span_123', { redacted: true });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent_spans/span_123');
    expect(url.searchParams.get('redacted')).toBe('true');
    expect(captured?.init?.method).toBe('GET');
    expect(response.details?.purpose).toBe('activity');
    expect(response.details?.schema_title).toBe('LLM call');
    expect(response.details?.summary).toBe('gpt-4 completed');
    expect(response.details?.payload_byte_size_estimate).toBe(128);
    expect(response.details?.data_risk).toBeNull();
  });

  test('agent span discardSensitive posts empty body', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'span_123' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentSpanClient(apiClient);

    await client.discardSensitive('span_123');

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe(
      '/api/v1/agent_spans/span_123/discard_sensitive'
    );
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe('{}');
  });

  test('alert list serializes nested active_during and pagination query keys', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AlertClient(apiClient);

    await client.list({
      agent_instance_id: 'agent_instance_1',
      status: 'raised',
      severity: 'warning',
      active_during: {
        start_at: '2024-01-01T00:00:00Z',
        finish_at: '2024-01-02T00:00:00Z',
      },
      pagination: { offset: 0, page_size: 25 },
    });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/alerts');
    expect(url.searchParams.get('agent_instance_id')).toBe('agent_instance_1');
    expect(url.searchParams.get('status')).toBe('raised');
    expect(url.searchParams.get('severity')).toBe('warning');
    expect(url.searchParams.get('active_during[start_at]')).toBe('2024-01-01T00:00:00Z');
    expect(url.searchParams.get('active_during[finish_at]')).toBe('2024-01-02T00:00:00Z');
    expect(url.searchParams.get('pagination[offset]')).toBe('0');
    expect(url.searchParams.get('pagination[page_size]')).toBe('25');
    expect(captured?.init?.method).toBe('GET');
  });

  test('alert count sends GET without a details wrapper', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ count: 3, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AlertClient(apiClient);

    const response = await client.count({ status: 'raised', severity: 'error' });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/alerts/count');
    expect(url.searchParams.get('status')).toBe('raised');
    expect(url.searchParams.get('severity')).toBe('error');
    expect(captured?.init?.method).toBe('GET');
    expect(response).toEqual({ count: 3, status: 'success' });
  });

  test('alert raise posts top-level fields without a details wrapper', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'alert_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AlertClient(apiClient);

    await client.raise({
      agent_instance_id: 'agent_instance_1',
      name: 'high_error_rate',
      severity: 'warning',
      payload: { count: 12 },
      payload_sensitive_encoding: true,
    });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/alerts/raise');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe(
      '{"agent_instance_id":"agent_instance_1","name":"high_error_rate","severity":"warning","payload":{"count":12},"payload_sensitive_encoding":true}'
    );
  });

  test('alert clear posts top-level fields without a details wrapper', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'alert_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AlertClient(apiClient);

    await client.clear({
      agent_instance_id: 'agent_instance_1',
      name: 'high_error_rate',
    });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/alerts/clear');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe(
      '{"agent_instance_id":"agent_instance_1","name":"high_error_rate"}'
    );
  });

  test('person list serializes team_id and nested pagination query keys', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new PersonClient(apiClient);

    await client.list({
      team_id: 'team_1',
      sorting: 'name',
      pagination: { offset: 0, page_size: 25 },
    });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/person');
    expect(url.searchParams.get('team_id')).toBe('team_1');
    expect(url.searchParams.get('sorting')).toBe('name');
    expect(url.searchParams.get('pagination[offset]')).toBe('0');
    expect(url.searchParams.get('pagination[page_size]')).toBe('25');
    expect(captured?.init?.method).toBe('GET');
  });

  test('person create wraps details without an idempotency key', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'person_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new PersonClient(apiClient);

    await client.create({
      email: 'jane@example.com',
      name: 'Jane Doe',
      team_ids: ['team_1'],
      title: 'Engineer',
    });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/person');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe(
      '{"details":{"email":"jane@example.com","name":"Jane Doe","team_ids":["team_1"],"title":"Engineer"}}'
    );
  });

  test('person update can clear team_ids and title', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'person_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new PersonClient(apiClient);

    await client.update('person_1', { team_ids: [], title: null });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe(
      '/api/v1/person/person_1'
    );
    expect(captured?.init?.method).toBe('PUT');
    expect(captured?.init?.body).toBe('{"details":{"team_ids":[],"title":null}}');
  });

  test('person delete sends DELETE and returns details', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'person_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new PersonClient(apiClient);

    const response = await client.delete('person_1');

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe(
      '/api/v1/person/person_1'
    );
    expect(captured?.init?.method).toBe('DELETE');
    expect(captured?.init?.body).toBeUndefined();
    expect(response.details?.id).toBe('person_1');
  });

  test('team list serializes nested pagination query keys', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new TeamClient(apiClient);

    await client.list({
      sorting: 'name',
      pagination: { offset: 0, page_size: 25 },
    });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/team');
    expect(url.searchParams.get('sorting')).toBe('name');
    expect(url.searchParams.get('pagination[offset]')).toBe('0');
    expect(url.searchParams.get('pagination[page_size]')).toBe('25');
    expect(captured?.init?.method).toBe('GET');
  });

  test('team create wraps details without an idempotency key', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'team_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new TeamClient(apiClient);

    await client.create({ name: 'Sales' });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/team');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe('{"details":{"name":"Sales"}}');
  });

  test('team update wraps name in details', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'team_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new TeamClient(apiClient);

    await client.update('team_1', { name: 'Engineering' });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/team/team_1');
    expect(captured?.init?.method).toBe('PUT');
    expect(captured?.init?.body).toBe('{"details":{"name":"Engineering"}}');
  });

  test('team delete sends DELETE and returns details', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'team_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new TeamClient(apiClient);

    const response = await client.delete('team_1');

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/team/team_1');
    expect(captured?.init?.method).toBe('DELETE');
    expect(captured?.init?.body).toBeUndefined();
    expect(response.details?.id).toBe('team_1');
  });

  test('risk profile list serializes nested pagination query keys', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ summaries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new RiskProfileClient(apiClient);

    await client.list({
      sorting: 'name',
      pagination: { offset: 0, page_size: 25 },
    });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/risk_profile');
    expect(url.searchParams.get('sorting')).toBe('name');
    expect(url.searchParams.get('pagination[offset]')).toBe('0');
    expect(url.searchParams.get('pagination[page_size]')).toBe('25');
    expect(captured?.init?.method).toBe('GET');
  });

  test('risk profile create wraps name and ruleset in details', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'rp_1' }, status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new RiskProfileClient(apiClient);
    const ruleset: RiskProfileRuleset = {
      action_multipliers: {
        create_data: 1,
        destroy_data: null,
        external_communication: 1,
        financial_transactions: null,
        read_data: 1,
        update_data: 1,
      },
      category_weights: {
        authentication_and_secrets: 1,
        behavioural_and_inferred: 0,
        contact_information: 1,
        criminal_justice: null,
        financial_information: 1,
        gdpr_biometric_for_identification: null,
        gdpr_genetic_data: null,
        gdpr_political_opinions: null,
        gdpr_racial_or_ethnic_origin: null,
        gdpr_religious_or_philosophical_beliefs: null,
        gdpr_sex_life_or_sexual_orientation: null,
        gdpr_trade_union_membership: null,
        health_and_medical: 1,
        location_and_tracking: 0,
        minors_data: 1,
        organisational_confidential: 1,
        personal_identifiers: 1,
      },
      thresholds: { critical: 80, high: 50, medium: 20 },
    };

    await client.create({ name: 'Standard', ruleset });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/risk_profile');
    expect(captured?.init?.method).toBe('POST');
    expect(JSON.parse(String(captured?.init?.body))).toEqual({
      details: { name: 'Standard', ruleset },
    });
  });

  test('risk profile template sends template_name without a details wrapper', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(
        JSON.stringify({
          ruleset: { thresholds: { critical: 80, high: 50, medium: 20 } },
          status: 'success',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new RiskProfileClient(apiClient);

    const response = await client.getTemplate('Standard');

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/risk_profile/template');
    expect(url.searchParams.get('template_name')).toBe('Standard');
    expect(captured?.init?.method).toBe('GET');
    expect(response.ruleset?.thresholds?.critical).toBe(80);
    expect(response.status).toBe('success');
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

  test('api token create wraps account-scoped payload in details', async () => {
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

    await client.create({ token_scope: 'account', account_id: 'acct_1' });

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/api_token');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe(
      '{"details":{"token_scope":"account","account_id":"acct_1"}}'
    );
  });

  test('api token create wraps deployment-scoped payload in details', async () => {
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

    await client.create({
      token_scope: 'agent_deployment',
      agent_id: 'agent_1',
      environment_id: 'env_1',
    });

    expect(captured?.init?.body).toBe(
      '{"details":{"token_scope":"agent_deployment","agent_id":"agent_1","environment_id":"env_1"}}'
    );
  });

  test('api token create normalizes top-level token into details', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          details: { id: 'tok_1', token_scope: 'account', status: 'active' },
          token: 'secret-token',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new ApiTokenClient(apiClient);

    const result = await client.create({ token_scope: 'account', account_id: 'acct_1' });

    expect(result).toEqual({
      details: {
        id: 'tok_1',
        token_scope: 'account',
        status: 'active',
        token: 'secret-token',
      },
    });
    expect(result.details.token).toBe('secret-token');
  });

  test('pfid generate sends non-details payload', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ pfids: ['pfid_1'], status: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new PfidClient(apiClient);

    const result = await client.generate(3, 'acct_123');

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/pfid/generate');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe('{"count":3,"account_id":"acct_123"}');
    expect(result).toEqual({ pfids: ['pfid_1'], status: 'success' });
  });

  test('bulk execute sends items as top-level body key', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(
        JSON.stringify({
          status: 'success',
          outputs: {
            'list-agents-001': { status: 'success', summaries: [] },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new BulkClient(apiClient);

    const result = await client.execute([
      { _type: 'agents/list', idempotency_key: 'list-agents-001' },
    ]);

    expect(new URL(captured?.url ?? 'https://example.com').pathname).toBe('/api/v1/bulk');
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.body).toBe(
      '{"items":[{"_type":"agents/list","idempotency_key":"list-agents-001"}]}'
    );
    expect(result).toEqual({
      status: 'success',
      outputs: {
        'list-agents-001': { status: 'success', summaries: [] },
      },
    });
  });

  test('agent instance register/start/finish contract remains unchanged', async () => {
    const calls: CapturedRequest[] = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ details: { id: 'agent_instance_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentInstanceClient(apiClient);

    await client.register({
      agent_id: 'agent_1',
      agent_version: { external_identifier: 'v1', name: 'Agent' },
      agent_schema_version: { external_identifier: 'schema_v1' },
    });
    await client.start('agent_instance_1', {
      timestamp: '2026-02-24T12:00:00.000Z',
    });
    await client.finish('agent_instance_1', {
      timestamp: '2026-02-24T12:05:00.000Z',
      status: 'complete',
    });

    const expected: Array<{ path: string; method: string; body: string }> = [
      {
        path: '/api/v1/agent_instance/register',
        method: 'POST',
        body: '{"agent_id":"agent_1","agent_version":{"external_identifier":"v1","name":"Agent"},"agent_schema_version":{"external_identifier":"schema_v1"}}',
      },
      {
        path: '/api/v1/agent_instance/agent_instance_1/start',
        method: 'POST',
        body: '{"timestamp":"2026-02-24T12:00:00.000Z"}',
      },
      {
        path: '/api/v1/agent_instance/agent_instance_1/finish',
        method: 'POST',
        body: '{"timestamp":"2026-02-24T12:05:00.000Z","status":"complete"}',
      },
    ];

    for (const [index, check] of expected.entries()) {
      const call = calls[index];
      const url = new URL(call?.url ?? 'https://example.com');
      expect(url.pathname).toBe(check.path);
      expect(call?.init?.method).toBe(check.method);
      const body = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
      const { idempotency_key: _key, ...rest } = body;
      expect(JSON.stringify(rest)).toBe(check.body);
    }
  });

  test('agent instance terminate posts reason and timestamp', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'agent_instance_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AgentInstanceClient(apiClient);

    await client.terminate('agent_instance_1', {
      reason: 'operator requested stop',
      timestamp: '2026-02-24T12:10:00.000Z',
    });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/agent_instance/agent_instance_1/terminate');
    expect(captured?.init?.method).toBe('POST');
    const body = JSON.parse(String(captured?.init?.body)) as Record<string, unknown>;
    const { idempotency_key: _key, ...rest } = body;
    expect(rest).toEqual({
      reason: 'operator requested stop',
      timestamp: '2026-02-24T12:10:00.000Z',
    });
  });

  test('admin user update sends details', async () => {
    let captured: CapturedRequest | undefined;
    globalThis.fetch = (async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ details: { id: 'admin_user_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const apiClient = new ApiClient('https://example.com', 'test-token');
    const client = new AdminUserClient(apiClient);

    await client.update('admin_user_1', {
      name: 'Ada Lovelace',
      job_title: 'Engineer',
      profile_completed_at: null,
    });

    const url = new URL(captured?.url ?? 'https://example.com');
    expect(url.pathname).toBe('/api/v1/admin_user/admin_user_1');
    expect(captured?.init?.method).toBe('PUT');
    expect(captured?.init?.body).toBe(
      '{"details":{"name":"Ada Lovelace","job_title":"Engineer","profile_completed_at":null}}'
    );
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

    await accountClient.update('acct_1', { name: 'Renamed' });
    await adminUserClient.list('acct_1');
    await adminUserInviteClient.create('user@example.com', 'acct_1');
    await agentVersionClient.create('agent_1', 'v1');
    await agentSchemaVersionClient.create('agent_1', 'schema_v1', {
      span_schemas: { root: { type: 'object' } },
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
