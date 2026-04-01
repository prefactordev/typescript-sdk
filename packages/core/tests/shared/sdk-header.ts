import { expect } from 'bun:test';

type FetchCall = {
  url: string;
  options?: RequestInit;
};

type SdkHeaderFetchRecorder = {
  fetch: typeof globalThis.fetch;
  fetchCalls: FetchCall[];
  getRegisterHeaders(): Headers;
  getRegisterPayload(): Record<string, unknown>;
};

export function createSdkHeaderFetchRecorder(options?: {
  includeSpanResponses?: boolean;
}): SdkHeaderFetchRecorder {
  const fetchCalls: FetchCall[] = [];
  const fetch: typeof globalThis.fetch = async (url, requestOptions) => {
    const requestUrl = String(url);
    fetchCalls.push({ url: requestUrl, options: requestOptions });

    if (requestUrl.endsWith('/agent_instance/register')) {
      return new Response(JSON.stringify({ details: { id: 'agent-instance-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (options?.includeSpanResponses && requestUrl.endsWith('/agent_spans')) {
      return new Response(JSON.stringify({ details: { id: 'span-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  function getRegisterCall(): FetchCall {
    const call = fetchCalls.find((entry) => entry.url.endsWith('/agent_instance/register'));
    if (!call) {
      throw new Error('Expected an agent_instance/register request');
    }
    return call;
  }

  return {
    fetch,
    fetchCalls,
    getRegisterHeaders(): Headers {
      return new Headers(getRegisterCall().options?.headers);
    },
    getRegisterPayload(): Record<string, unknown> {
      const body = getRegisterCall().options?.body;
      if (typeof body !== 'string') {
        throw new Error('Expected register payload body to be a JSON string');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body) as unknown;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse register payload JSON: ${message}`);
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected register payload to parse to an object');
      }

      return parsed as Record<string, unknown>;
    },
  };
}

export function expectSdkHeaderHeaders(headers: Headers, sdkHeaderEntry: string): void {
  expect(headers.get('X-Prefactor-SDK')).toContain(sdkHeaderEntry);
  expect(headers.get('X-Prefactor-SDK')).toContain('prefactor/core@');
}

export function expectRuntimeMetadataOmitted(payload: Record<string, unknown>): void {
  expect(payload.runtime_environment).toBeUndefined();
}
