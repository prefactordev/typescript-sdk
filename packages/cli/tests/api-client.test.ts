import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ApiClient } from '../src/api-client.js';

describe('ApiClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('preserves /api/v1 prefix when path already has query', async () => {
    let requestUrl = '';
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApiClient('https://example.com', 'test-token');
    await client.request('/api/v1?existing=true', {
      method: 'GET',
      query: { page: 2 },
    });

    const prefixedUrl = new URL(requestUrl);
    expect(prefixedUrl.pathname).toBe('/api/v1');
    expect(prefixedUrl.searchParams.get('existing')).toBe('true');
    expect(prefixedUrl.searchParams.get('page')).toBe('2');
  });

  test('serializes query params for prefixed endpoint paths', async () => {
    let requestUrl = '';
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApiClient('https://example.com', 'test-token');
    await client.request('/agent_spans', {
      method: 'GET',
      query: { search: 'hello world', includeArchived: false },
    });

    const queriedUrl = new URL(requestUrl);
    expect(queriedUrl.pathname).toBe('/api/v1/agent_spans');
    expect(queriedUrl.searchParams.get('search')).toBe('hello world');
    expect(queriedUrl.searchParams.get('includeArchived')).toBe('false');
  });

  test('appends query params before URL hash', async () => {
    let requestUrl = '';
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApiClient('https://example.com', 'test-token');
    await client.request('/api/v1/agent_spans#cursor', {
      method: 'GET',
      query: { page: 2 },
    });

    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/api/v1/agent_spans');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.hash).toBe('#cursor');
  });

  test('does not send a request body for GET requests', async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_input, requestInit) => {
      init = requestInit;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApiClient('https://example.com', 'test-token');
    await client.request('/agent_spans', {
      method: 'GET',
      body: { should: 'be-ignored' },
    });

    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  test('sends JSON body for POST requests', async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_input, requestInit) => {
      init = requestInit;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApiClient('https://example.com', 'test-token');
    await client.request('/agent_spans', {
      method: 'POST',
      body: { name: 'demo' },
    });

    const headers = new Headers(init?.headers);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"name":"demo"}');
    expect(headers.get('content-type')).toBe('application/json');
  });

  test('api client retries on default retryable status codes', async () => {
    const retryableStatus = 598;

    let attempts = 0;
    globalThis.fetch = (async (_input, _init) => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: 'retry me' }), {
          status: retryableStatus,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApiClient('https://example.com', 'test-token');
    const response = await client.request<{ ok: boolean }>('/agent_spans');

    expect(response).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });
});
