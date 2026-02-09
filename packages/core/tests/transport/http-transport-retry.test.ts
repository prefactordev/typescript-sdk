import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { HttpTransport } from '../../src/transport/http.js';

const createConfig = () => ({
  apiUrl: 'https://example.com',
  apiToken: 'test-token',
  agentIdentifier: '1.0.0',
  requestTimeout: 1_000,
  maxRetries: 1,
  initialRetryDelay: 1,
  maxRetryDelay: 1,
  retryMultiplier: 1,
  retryOnStatusCodes: [503],
});

describe('HttpTransport retry policy integration', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('retries agent lifecycle requests via shared client policy', async () => {
    let startAttempts = 0;

    globalThis.fetch = (async (url) => {
      const urlString = String(url);
      if (urlString.endsWith('/agent_instance/register')) {
        return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlString.endsWith('/agent_instance/agent-instance-1/start')) {
        startAttempts += 1;
        if (startAttempts === 1) {
          return new Response(JSON.stringify({ error: 'temporary unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const transport = new HttpTransport(createConfig());
    transport.startAgentInstance();
    await transport.close();

    expect(startAttempts).toBe(2);
  });
});
