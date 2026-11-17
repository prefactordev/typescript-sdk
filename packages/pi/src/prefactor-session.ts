import {
  AgentInstanceClient,
  type AgentInstanceRegisterPayload,
  type AgentSchemaVersion,
  AgentSpanClient,
  buildRuntimeEnvironment,
  getLogger,
  HttpClient,
  type HttpRequester,
  type HttpTransportConfig,
} from '@prefactor/core';

const logger = getLogger('pi');

const RETRY_ON_STATUS_CODES = [429, ...Array.from({ length: 100 }, (_, index) => 500 + index)];
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * A span sent, or being sent, to Prefactor. `id` resolves to the backend span id, or `null` when
 * the span could not be created.
 */
export interface SpanHandle {
  readonly id: Promise<string | null>;
  /** When the span started, in milliseconds since the epoch, as sent to Prefactor. */
  readonly startedAt: number;
}

export type SpanStatus = 'complete' | 'failed' | 'cancelled';

/** Whether the agent instance has started: still registering, started, or failed to start. */
export type StartState = 'pending' | 'started' | 'failed';

export interface PrefactorSessionOptions {
  apiUrl: string;
  apiToken: string;
  /** Prefactor agent id. Read from the token with `GET /api/v1/ping` when omitted. */
  agentId?: string;
  agentVersion: { external_identifier: string; name: string; description: string };
  agentSchemaVersion: AgentSchemaVersion;
  /** Space-separated `package@version` entries sent in the SDK header and runtime environment. */
  sdkHeaderEntry: string;
  /** Called once for the first request that fails. */
  onError?: (error: unknown) => void;
  /** How long {@link PrefactorSession.finish} waits for queued requests. Defaults to 10 seconds. */
  shutdownTimeoutMs?: number;
}

export interface StartSpanOptions {
  schemaName: string;
  payload: Record<string, unknown>;
  parent?: SpanHandle | null;
  startedAt?: number;
}

export interface RecordSpanOptions extends StartSpanOptions {
  status: SpanStatus;
  resultPayload: Record<string, unknown>;
  finishedAt: number;
}

/**
 * Creates the HTTP requester used for Prefactor API calls made by the extension.
 */
export function createHttpClient(
  apiUrl: string,
  apiToken: string,
  sdkHeaderEntry: string
): HttpClient {
  const config: HttpTransportConfig = {
    apiUrl,
    apiToken,
    agentIdentifier: 'pi',
    requestTimeout: 30_000,
    maxRetries: 3,
    initialRetryDelay: 1_000,
    maxRetryDelay: 10_000,
    retryMultiplier: 2,
    retryOnStatusCodes: RETRY_ON_STATUS_CODES,
  };
  return new HttpClient(config, {}, sdkHeaderEntry);
}

type PingResponse = { details?: { agent_id?: string } };

/**
 * Reads the agent id of an agent-deployment token from `GET /api/v1/ping`.
 */
export async function fetchAgentId(client: HttpRequester): Promise<string> {
  const response = await client.request<PingResponse>('/api/v1/ping', { method: 'GET' });
  const agentId = response.details?.agent_id;
  if (!agentId) {
    throw new Error('GET /api/v1/ping did not return an agent_id for this token');
  }
  return agentId;
}

/**
 * One Prefactor agent instance and its spans.
 *
 * Every call returns at once and queues its request, so pi is never held up by the network. The
 * queue sends requests one at a time in call order, so a parent span is created before its
 * children and finished after them. Each span is sent as soon as it starts or finishes, so a
 * session ended without `session_shutdown` loses only the spans still open. Shutdown waits for
 * queued requests only up to a deadline, so an unreachable API cannot hold up pi's exit.
 */
export class PrefactorSession {
  private readonly instanceClient: AgentInstanceClient;
  private readonly spanClient: AgentSpanClient;
  private readonly instanceId: Promise<string | null>;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly onError?: (error: unknown) => void;
  private readonly shutdownTimeoutMs: number;
  private errorReported = false;
  private startState: StartState = 'pending';
  private finished = false;
  private lastError: unknown = null;

  constructor(options: PrefactorSessionOptions, httpClient?: HttpRequester) {
    const client = this.trackRequests(
      httpClient ?? createHttpClient(options.apiUrl, options.apiToken, options.sdkHeaderEntry)
    );
    this.instanceClient = new AgentInstanceClient(client);
    this.spanClient = new AgentSpanClient(client);
    this.onError = options.onError;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

    const startedAt = new Date().toISOString();
    this.instanceId = this.enqueue(async () => {
      const registerPayload: AgentInstanceRegisterPayload = {
        agent_id: options.agentId ?? (await fetchAgentId(client)),
        agent_version: {
          ...options.agentVersion,
          runtime_environment: buildRuntimeEnvironment(options.sdkHeaderEntry),
        },
        agent_schema_version: options.agentSchemaVersion,
      };
      const response = await this.instanceClient.register(registerPayload);
      const id = response.details.id;
      await this.instanceClient.start(id, { timestamp: startedAt });
      return id;
    });
    void this.instanceId.then((id) => {
      this.startState = id === null ? 'failed' : 'started';
    });
  }

  /** Whether the agent instance has started. A session that failed to start records nothing. */
  getStartState(): StartState {
    return this.startState;
  }

  /** Resolves once starting the agent instance has succeeded (`true`) or failed (`false`). */
  async whenStartSettled(): Promise<boolean> {
    return (await this.instanceId) !== null;
  }

  /**
   * Error from the most recent failed request or operation, or `null` when the last request sent
   * succeeded. Operations skipped because an earlier one failed do not clear it.
   */
  getLastError(): unknown {
    return this.lastError;
  }

  /**
   * Creates an active span now and returns a handle to finish it later.
   */
  startSpan(options: StartSpanOptions): SpanHandle {
    const startedAt = options.startedAt ?? Date.now();
    return {
      startedAt,
      id: this.enqueue(() =>
        this.createSpan({
          ...options,
          startedAt,
          status: 'active',
          finishedAt: null,
          resultPayload: undefined,
        })
      ),
    };
  }

  /**
   * Creates a span that has already finished, in one request.
   */
  recordSpan(options: RecordSpanOptions): SpanHandle {
    const startedAt = options.startedAt ?? Date.now();
    return { startedAt, id: this.enqueue(() => this.createSpan({ ...options, startedAt })) };
  }

  /**
   * Finishes a span created with {@link startSpan} at `finishedAt`, or now when it is omitted.
   * The finish time is never earlier than the span's start time.
   */
  finishSpan(
    span: SpanHandle,
    status: SpanStatus,
    resultPayload: Record<string, unknown>,
    finishedAt: number = Date.now()
  ): void {
    const timestamp = new Date(Math.max(finishedAt, span.startedAt)).toISOString();
    this.enqueue(async () => {
      const id = await span.id;
      if (!id) {
        return;
      }
      await this.spanClient.finish(id, timestamp, {
        status,
        result_payload: resultPayload,
      });
    });
  }

  /**
   * Finishes the agent instance after every queued request, and waits for it to be sent, but no
   * longer than the shutdown timeout. Requests still queued after the timeout keep running in the
   * background. Calling it more than once has no further effect.
   */
  async finish(): Promise<void> {
    if (this.finished) {
      return;
    }
    this.finished = true;

    const timestamp = new Date().toISOString();
    const sent = this.enqueue(async () => {
      const instanceId = await this.instanceId;
      if (instanceId) {
        await this.instanceClient.finish(instanceId, { status: 'complete', timestamp });
      }
      return true;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), this.shutdownTimeoutMs);
      timer.unref?.();
    });
    try {
      if ((await Promise.race([sent, timedOut])) === false) {
        logger.debug(
          `Stopped waiting for Prefactor requests after ${this.shutdownTimeoutMs} ms at shutdown`
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Waits until every request queued so far has been sent.
   */
  async flush(): Promise<void> {
    await this.tail;
  }

  private async createSpan(
    options: StartSpanOptions & {
      status: SpanStatus | 'active';
      resultPayload: Record<string, unknown> | undefined;
      finishedAt: number | null;
    }
  ): Promise<string | null> {
    const instanceId = await this.instanceId;
    const parentId = options.parent ? await options.parent.id : null;
    if (!instanceId || (options.parent && !parentId)) {
      return null;
    }

    const response = await this.spanClient.create({
      details: {
        agent_instance_id: instanceId,
        schema_name: options.schemaName,
        status: options.status,
        payload: options.payload,
        ...(options.resultPayload ? { result_payload: options.resultPayload } : {}),
        parent_span_id: parentId,
        started_at: new Date(options.startedAt ?? Date.now()).toISOString(),
        finished_at:
          options.finishedAt === null ? null : new Date(options.finishedAt).toISOString(),
      },
    });
    return response.details.id;
  }

  /**
   * Queues a request behind every earlier one. Failures are logged and resolve to `null`, because
   * instrumentation must never break pi. The returned promise never rejects, so the queue keeps
   * running after any failure.
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T | null> {
    const promise = this.tail.then(operation).then(
      (value) => value,
      (error: unknown) => {
        this.lastError = error;
        logger.debug('Prefactor request failed', error);
        if (!this.errorReported) {
          this.errorReported = true;
          try {
            this.onError?.(error);
          } catch (callbackError) {
            logger.debug('Prefactor onError callback failed', callbackError);
          }
        }
        return null;
      }
    );
    this.tail = promise;
    return promise;
  }

  /**
   * Wraps a requester so that `lastError` reflects the outcome of the last request actually sent.
   */
  private trackRequests(client: HttpRequester): HttpRequester {
    return {
      request: async <TResponse>(
        ...args: Parameters<HttpRequester['request']>
      ): Promise<TResponse> => {
        try {
          const response = await client.request<TResponse>(...args);
          this.lastError = null;
          return response;
        } catch (error) {
          this.lastError = error;
          throw error;
        }
      },
    };
  }
}
