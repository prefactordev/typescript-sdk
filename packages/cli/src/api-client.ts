import { HttpClient, type HttpTransportConfig } from '@prefactor/core';

const API_PREFIX = '/api/v1';
const RETRY_ON_STATUS_CODES = [429, ...Array.from({ length: 100 }, (_, index) => 500 + index)];

export type ApiClientMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type QueryPrimitive = string | number | boolean | null | undefined;

export type ApiClientQuery = Record<string, QueryPrimitive | QueryPrimitive[]>;

export interface ApiClientRequestOptions {
  method?: ApiClientMethod;
  query?: ApiClientQuery;
  body?: unknown;
  headers?: RequestInit['headers'];
  timeoutMs?: number;
}

export class ApiClient {
  private readonly httpClient: HttpClient;

  constructor(apiUrl: string, apiToken: string) {
    const config: HttpTransportConfig = {
      apiUrl,
      apiToken,
      agentIdentifier: 'cli',
      requestTimeout: 10_000,
      maxRetries: 2,
      initialRetryDelay: 250,
      maxRetryDelay: 2_000,
      retryMultiplier: 2,
      retryOnStatusCodes: RETRY_ON_STATUS_CODES,
    };

    this.httpClient = new HttpClient(config);
  }

  request<TResponse = unknown>(
    path: string,
    options: ApiClientRequestOptions = {}
  ): Promise<TResponse> {
    const method = options.method ?? 'GET';
    const prefixedPath = ensureApiPrefix(path);
    const requestPath = appendQueryParams(prefixedPath, options.query);
    // GET request bodies are intentionally ignored to avoid invalid payload handling.
    const body = method === 'GET' ? undefined : options.body;

    return this.httpClient.request<TResponse>(requestPath, {
      method,
      headers: options.headers,
      timeoutMs: options.timeoutMs,
      body,
    });
  }
}

function ensureApiPrefix(path: string): string {
  if (
    path === API_PREFIX ||
    path.startsWith(`${API_PREFIX}/`) ||
    path.startsWith(`${API_PREFIX}?`) ||
    path.startsWith(`${API_PREFIX}#`)
  ) {
    return path;
  }

  if (path.length === 0) {
    return API_PREFIX;
  }

  if (path.startsWith('/')) {
    return `${API_PREFIX}${path}`;
  }

  return `${API_PREFIX}/${path}`;
}

function appendQueryParams(path: string, query: ApiClientQuery | undefined): string {
  if (!query) {
    return path;
  }

  const hashIndex = path.indexOf('#');
  const pathWithoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex);

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        appendQueryValue(search, key, item);
      }
      continue;
    }

    appendQueryValue(search, key, value);
  }

  const queryString = search.toString();
  if (!queryString) {
    return path;
  }

  const separator = pathWithoutHash.includes('?') ? '&' : '?';
  return `${pathWithoutHash}${separator}${queryString}${hash}`;
}

function appendQueryValue(search: URLSearchParams, key: string, value: QueryPrimitive): void {
  if (value === null || value === undefined) {
    return;
  }

  search.append(key, String(value));
}
