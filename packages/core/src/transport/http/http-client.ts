import type { HttpTransportConfig } from '../../config.js';
import { calculateRetryDelay, shouldRetryStatusCode } from './retry-policy.js';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type HttpClientDependencies = {
  fetchFn?: FetchLike;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
};

export type HttpRequestOptions = Omit<RequestInit, 'body' | 'headers' | 'signal'> & {
  body?: unknown;
  headers?: RequestInit['headers'];
  timeoutMs?: number;
};

export interface HttpRequester {
  request<TResponse = unknown>(path: string, options?: HttpRequestOptions): Promise<TResponse>;
}

type HttpClientErrorOptions = {
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  responseBody?: unknown;
  retryable: boolean;
  cause?: unknown;
};

export class HttpClientError extends Error {
  readonly url: string;
  readonly method: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly responseBody?: unknown;
  readonly retryable: boolean;

  constructor(message: string, options: HttpClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'HttpClientError';
    this.url = options.url;
    this.method = options.method;
    this.status = options.status;
    this.statusText = options.statusText;
    this.responseBody = options.responseBody;
    this.retryable = options.retryable;
  }
}

export class HttpClient {
  private readonly fetchFn: FetchLike;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly config: HttpTransportConfig,
    dependencies: HttpClientDependencies = {}
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.sleep = dependencies.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.random = dependencies.random ?? Math.random;
  }

  async request<TResponse = unknown>(
    path: string,
    options: HttpRequestOptions = {}
  ): Promise<TResponse> {
    const url = new URL(path, this.config.apiUrl).toString();
    const method = options.method ?? 'GET';
    let attempt = 0;

    while (true) {
      const headers = new Headers(options.headers);
      headers.set('Authorization', `Bearer ${this.config.apiToken}`);
      if (options.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const requestInit: RequestInit = {
        ...options,
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? this.config.requestTimeout),
      };

      try {
        const response = await this.fetchFn(url, requestInit);
        if (response.ok) {
          return (await parseResponseBody(response)) as TResponse;
        }

        const responseBody = await parseResponseBody(response);
        const canRetry =
          attempt < this.config.maxRetries &&
          shouldRetryStatusCode(response.status, this.config.retryOnStatusCodes);

        if (canRetry) {
          const delayMs = calculateRetryDelay(attempt, this.config, this.random);
          await this.sleep(delayMs);
          attempt += 1;
          continue;
        }

        throw new HttpClientError(`HTTP request failed with status ${response.status}`, {
          url,
          method,
          status: response.status,
          statusText: response.statusText,
          responseBody,
          retryable: shouldRetryStatusCode(response.status, this.config.retryOnStatusCodes),
        });
      } catch (error) {
        if (error instanceof HttpClientError) {
          throw error;
        }

        const canRetry = attempt < this.config.maxRetries && isRetryableNetworkError(error);
        if (canRetry) {
          const delayMs = calculateRetryDelay(attempt, this.config, this.random);
          await this.sleep(delayMs);
          attempt += 1;
          continue;
        }

        throw new HttpClientError('HTTP request failed due to network error', {
          url,
          method,
          retryable: false,
          cause: error,
        });
      }
    }
  }
}

function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return true;
  }

  return false;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const bodyText = await response.text();
  if (!bodyText) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      return bodyText;
    }
  }

  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText;
  }
}
