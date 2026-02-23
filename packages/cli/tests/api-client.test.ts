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

  test('prefixes request paths with /api/v1', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApiClient('https://example.com', 'test-token');
    await client.request('/agent_spans');
    await client.request('/api/v1/agent_spans');

    expect(calls[0]?.url).toBe('https://example.com/api/v1/agent_spans');
    expect(calls[1]?.url).toBe('https://example.com/api/v1/agent_spans');
  });

  test('serializes query params into URL search string', async () => {
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
      query: {
        page: 2,
        search: 'hello world',
        includeArchived: false,
      },
    });

    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/api/v1/agent_spans');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('search')).toBe('hello world');
    expect(url.searchParams.get('includeArchived')).toBe('false');
  });

  test('does not duplicate /api/v1 prefix when path already includes query', async () => {
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
      query: {
        page: 2,
      },
    });

    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/api/v1');
    expect(url.searchParams.get('existing')).toBe('true');
    expect(url.searchParams.get('page')).toBe('2');
  });

  test('does not duplicate /api/v1 prefix when path already includes hash', async () => {
    let requestUrl = '';
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApiClient('https://example.com', 'test-token');
    await client.request('/api/v1#cursor');

    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/api/v1');
    expect(url.hash).toBe('#cursor');
  });

  test('appends query before hash fragments', async () => {
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
      query: {
        page: 2,
      },
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
});
