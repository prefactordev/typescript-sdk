import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { HttpTransportConfig } from '../../src/config.js';
import {
  type FetchLike,
  HttpClient,
  HttpClientError,
} from '../../src/transport/http/http-client.js';

const baseConfig: HttpTransportConfig = {
  apiUrl: 'https://example.com',
  apiToken: 'test-token',
  agentIdentifier: '1.0.0',
  requestTimeout: 1_000,
  maxRetries: 2,
  initialRetryDelay: 100,
  maxRetryDelay: 1_000,
  retryMultiplier: 2,
  retryOnStatusCodes: [429, ...Array.from({ length: 100 }, (_, index) => 500 + index)],
};

describe('HttpClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('retries retryable HTTP status codes with backoff', async () => {
    let attempts = 0;
    const sleepCalls: number[] = [];

    const fetchFn: FetchLike = async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response(JSON.stringify({ error: 'temporary' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new HttpClient(baseConfig, {
      fetchFn,
      sleep: async (delayMs) => {
        sleepCalls.push(delayMs);
      },
      random: () => 0,
    });

    const response = await client.request<{ ok: boolean }>('/api/v1/test', { method: 'POST' });

    expect(response.ok).toBe(true);
    expect(attempts).toBe(3);
    expect(sleepCalls).toEqual([50, 100]);
  });

  test('retries network errors then succeeds', async () => {
    let attempts = 0;
    const sleepCalls: number[] = [];

    const fetchFn: FetchLike = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError('network down');
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new HttpClient(baseConfig, {
      fetchFn,
      sleep: async (delayMs) => {
        sleepCalls.push(delayMs);
      },
      random: () => 0,
    });

    const response = await client.request<{ ok: boolean }>('/api/v1/test');

    expect(response.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(sleepCalls).toEqual([50]);
  });

  test('includes authorization and content-type headers', async () => {
    let requestHeaders: Headers | undefined;

    const fetchFn: FetchLike = async (_url, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new HttpClient(baseConfig, { fetchFn });
    await client.request('/api/v1/test', { method: 'POST', body: { hello: 'world' } });

    expect(requestHeaders?.get('Authorization')).toBe('Bearer test-token');
    expect(requestHeaders?.get('Content-Type')).toBe('application/json');
  });

  test('throws graceful error object with parsed JSON body', async () => {
    const fetchFn: FetchLike = async () =>
      new Response(JSON.stringify({ error: 'bad request' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'Content-Type': 'application/json' },
      });

    const client = new HttpClient(baseConfig, { fetchFn });

    await expect(client.request('/api/v1/test')).rejects.toBeInstanceOf(HttpClientError);
    await expect(client.request('/api/v1/test')).rejects.toMatchObject({
      status: 400,
      statusText: 'Bad Request',
      retryable: false,
      responseBody: { error: 'bad request' },
    });
  });

  test('retries non-explicit 5xx status by default policy', async () => {
    let attempts = 0;

    const fetchFn: FetchLike = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: 'not implemented' }), {
          status: 501,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new HttpClient(baseConfig, {
      fetchFn,
      sleep: async () => {},
      random: () => 0,
    });

    const response = await client.request<{ ok: boolean }>('/api/v1/test');

    expect(response.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  test('does not retry non-network thrown errors from fetch', async () => {
    let attempts = 0;

    const fetchFn: FetchLike = async () => {
      attempts += 1;
      throw new Error('programming error');
    };

    const client = new HttpClient(baseConfig, {
      fetchFn,
      sleep: async () => {},
      random: () => 0,
    });

    await expect(client.request('/api/v1/test')).rejects.toBeInstanceOf(HttpClientError);
    expect(attempts).toBe(1);
  });

  test('retries timeout-like errors', async () => {
    let attempts = 0;

    const fetchFn: FetchLike = async () => {
      attempts += 1;
      if (attempts === 1) {
        const timeoutError = new Error('timed out');
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new HttpClient(baseConfig, {
      fetchFn,
      sleep: async () => {},
      random: () => 0,
    });

    const response = await client.request<{ ok: boolean }>('/api/v1/test');
    expect(response.ok).toBe(true);
    expect(attempts).toBe(2);
  });
});
