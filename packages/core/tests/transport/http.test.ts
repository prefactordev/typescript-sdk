import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { HttpTransport } from '../../src/transport/http.js';
import type { QueueAction } from '../../src/queue/actions.js';

const createConfig = () => ({
  apiUrl: 'https://example.com',
  apiToken: 'test-token',
  requestTimeout: 1000,
  connectTimeout: 1000,
  maxRetries: 0,
  initialRetryDelay: 1,
  maxRetryDelay: 1,
  retryMultiplier: 1,
  skipSchema: false,
});

describe('HttpTransport processBatch', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('updates config from schema_register and agent_start actions', async () => {
    const transport = new HttpTransport(createConfig());
    const actions: QueueAction[] = [
      {
        type: 'schema_register',
        data: {
          schemaName: 'prefactor:agent',
          schemaVersion: '2.0.0',
          schema: { type: 'object' },
        },
      },
      {
        type: 'agent_start',
        data: {
          agentId: 'agent-123',
          agentVersion: '2.0.0',
          agentName: 'Test Agent',
          agentDescription: 'Test description',
          schemaName: 'prefactor:agent',
          schemaVersion: '2.0.0',
        },
      },
    ];

    await transport.processBatch(actions);

    const config = (transport as any).config as ReturnType<typeof createConfig> & {
      agentId?: string;
      agentVersion?: string;
      agentName?: string;
      agentDescription?: string;
      agentSchema?: Record<string, unknown>;
      agentSchemaVersion?: string;
      schemaName?: string;
      schemaVersion?: string;
    };

    expect(config.agentId).toBe('agent-123');
    expect(config.agentVersion).toBe('2.0.0');
    expect(config.agentName).toBe('Test Agent');
    expect(config.agentDescription).toBe('Test description');
    expect(config.agentSchema).toEqual({ type: 'object' });
    expect(config.agentSchemaVersion).toBe('2.0.0');
    expect(config.schemaName).toBe('prefactor:agent');
    expect(config.schemaVersion).toBe('2.0.0');

    await transport.close();
  });
});
