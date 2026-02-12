import { describe, expect, test } from 'bun:test';
import { AgentInstanceClient } from '../../src/transport/http/agent-instance-client.js';
import { AgentSpanClient } from '../../src/transport/http/agent-span-client.js';
import type { HttpRequestOptions } from '../../src/transport/http/http-client.js';

type RequestCall = {
  path: string;
  options: HttpRequestOptions;
};

describe('HTTP endpoint clients', () => {
  test('agent instance client posts register, start, and finish to expected endpoints', async () => {
    const calls: RequestCall[] = [];
    const httpClient = {
      request: async <TResponse>(path: string, options: HttpRequestOptions = {}) => {
        calls.push({ path, options });
        return { details: { id: 'agent-instance-1' } } as TResponse;
      },
    };

    const client = new AgentInstanceClient(httpClient);

    await client.register({
      agent_id: 'agent-123',
      agent_version: {
        external_identifier: 'v1.0.0',
        name: 'Test Agent',
        description: 'test',
      },
      agent_schema_version: { type: 'object' },
    });
    await client.start('agent-instance-1');
    await client.finish('agent-instance-1');

    expect(calls).toEqual([
      {
        path: '/api/v1/agent_instance/register',
        options: {
          method: 'POST',
          body: {
            agent_id: 'agent-123',
            agent_version: {
              external_identifier: 'v1.0.0',
              name: 'Test Agent',
              description: 'test',
            },
            agent_schema_version: { type: 'object' },
          },
        },
      },
      {
        path: '/api/v1/agent_instance/agent-instance-1/start',
        options: {
          method: 'POST',
          body: {},
        },
      },
      {
        path: '/api/v1/agent_instance/agent-instance-1/finish',
        options: {
          method: 'POST',
          body: {},
        },
      },
    ]);
  });

  test('agent span client posts create and finish to expected endpoints', async () => {
    const calls: RequestCall[] = [];
    const httpClient = {
      request: async <TResponse>(path: string, options: HttpRequestOptions = {}) => {
        calls.push({ path, options });
        return { details: { id: 'backend-span-1' } } as TResponse;
      },
    };

    const client = new AgentSpanClient(httpClient);

    await client.create({
      details: {
        agent_instance_id: 'agent-instance-1',
        schema_name: 'llm',
        status: 'complete',
        payload: {
          span_id: 'span-1',
          trace_id: 'trace-1',
          name: 'Span 1',
          status: 'complete',
          inputs: { prompt: 'hello' },
          outputs: { text: 'world' },
          metadata: {},
          token_usage: null,
          error: null,
        },
        parent_span_id: null,
        started_at: '2026-02-09T00:00:00.000Z',
        finished_at: '2026-02-09T00:00:01.000Z',
      },
    });

    await client.finish('backend-span-1', '2026-02-09T00:00:01.000Z', {
      status: 'complete',
      result_payload: { text: 'world' },
    });

    expect(calls).toEqual([
      {
        path: '/api/v1/agent_spans',
        options: {
          method: 'POST',
          body: {
            details: {
              agent_instance_id: 'agent-instance-1',
              schema_name: 'llm',
              status: 'complete',
              payload: {
                span_id: 'span-1',
                trace_id: 'trace-1',
                name: 'Span 1',
                status: 'complete',
                inputs: { prompt: 'hello' },
                outputs: { text: 'world' },
                metadata: {},
                token_usage: null,
                error: null,
              },
              parent_span_id: null,
              started_at: '2026-02-09T00:00:00.000Z',
              finished_at: '2026-02-09T00:00:01.000Z',
            },
          },
        },
      },
      {
        path: '/api/v1/agent_spans/backend-span-1/finish',
        options: {
          method: 'POST',
          body: {
            timestamp: '2026-02-09T00:00:01.000Z',
            status: 'complete',
            result_payload: { text: 'world' },
          },
        },
      },
    ]);
  });
});
