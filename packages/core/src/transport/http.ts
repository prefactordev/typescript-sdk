import type { HttpTransportConfig } from '../config.js';
import type {
  FailureHandlingConfig,
  PrefactorTransportHealthState,
  PrefactorTransportOperation,
} from '../errors.js';
import { PrefactorFatalError, PrefactorShutdownError } from '../errors.js';
import type {
  AgentFinishAction,
  AgentStartAction,
  SpanEndAction,
  SpanFinishAction,
  TransportAction,
} from '../queue/actions.js';
import { InMemoryQueue } from '../queue/in-memory-queue.js';
import { TaskExecutor } from '../queue/task-executor.js';
import { buildSpanResultPayload } from '../tracing/result-payload.js';
import type { Span } from '../tracing/span.js';
import { getLogger } from '../utils/logging.js';
import { AgentInstanceClient } from './http/agent-instance-client.js';
import {
  AgentSpanClient,
  type AgentSpanCreatePayload,
  type AgentSpanFinishStatus,
  type AgentSpanStatus,
} from './http/agent-span-client.js';
import { HttpClient, HttpClientError, type HttpRequester } from './http/http-client.js';
import { ensureIdempotencyKey } from './http/idempotency.js';
import { calculateRetryDelay } from './http/retry-policy.js';

export type AgentInstanceOptions = {
  /** Existing backend agent id, when available. */
  agentId?: string;
  /** External agent version identifier. */
  agentIdentifier?: string;
  /** Human-readable agent name. */
  agentName?: string;
  /** Human-readable agent description. */
  agentDescription?: string;
};

export type TransientFailureKind =
  | 'agent_not_found'
  | 'network'
  | 'rate_limit'
  | 'backend_transient';

type HttpTransportOptions = {
  failureHandling?: FailureHandlingConfig;
  sdkHeaderEntry?: string;
};

type RetryableAction = AgentStartAction | AgentFinishAction | SpanEndAction | SpanFinishAction;
type RetryTimerMetadata = {
  operation: PrefactorTransportOperation;
};

type FailureClassification =
  | {
      type: 'fatal';
      error: PrefactorFatalError;
    }
  | {
      type: 'transient';
      kind: TransientFailureKind;
      error: HttpClientError;
    }
  | {
      type: 'unexpected';
    };

const logger = getLogger('http-transport');

/**
 * Transport contract used by the tracer and runtime.
 */
export interface Transport {
  emit(span: Span): void;

  finishSpan(spanId: string, endTime: number, options?: FinishSpanOptions): void;

  startAgentInstance(options?: AgentInstanceOptions): void;

  finishAgentInstance(): void;

  registerSchema(schema: Record<string, unknown>): void;

  assertUsable(operation: PrefactorTransportOperation): void;

  getHealthState(): PrefactorTransportHealthState;

  close(): void | Promise<void>;

  getAgentInstanceId(): string | null;

  getHttpRequester(): HttpRequester;
}

export type FinishSpanOptions = {
  /** Final status sent to backend when finishing deferred spans. */
  status?: AgentSpanFinishStatus;
  /** Optional normalized payload included in finish request. */
  resultPayload?: Record<string, unknown>;
};

/**
 * HTTP-backed transport that serializes span operations through an internal queue.
 */
export class HttpTransport implements Transport {
  private closed = false;
  private healthState: PrefactorTransportHealthState = 'healthy';
  private fatalError: PrefactorFatalError | null = null;
  private fatalErrorNotified = false;
  private readonly actionQueue = new InMemoryQueue<TransportAction>();
  private readonly taskExecutor: TaskExecutor<TransportAction>;
  private readonly agentInstanceClient: AgentInstanceClient;
  private readonly agentSpanClient: AgentSpanClient;
  private readonly httpClient: HttpClient;
  private readonly onFatalError?: (error: PrefactorFatalError) => void;
  private readonly retryTimers = new Map<ReturnType<typeof setTimeout>, RetryTimerMetadata>();
  private readonly transientFailureCounts = new Map<string, number>();
  private previousAgentSchema: string | null = null;
  private requiresNewAgentIdentifier = false;
  private previousAgentIdentifier: string | null = null;
  private latestAgentIdentifier: string | undefined;
  private schemaRevision = 0;
  private agentInstanceId: string | null = null;
  private currentAgentRegisterIdempotencyKey: string | null = null;
  private spanIdMap = new Map<string, string>();
  private pendingFinishes = new Map<string, SpanFinishAction>();
  private pendingChildren = new Map<string, SpanEndAction[]>();
  private droppedAfterClose = 0;
  private cancelledScheduledRetries = 0;
  private partialTelemetryEvents = 0;
  private controlSignalCallback?: (reason: string | null) => void;

  /** @internal */
  constructor(config: HttpTransportConfig, sdkHeaderEntry: string);
  constructor(config: HttpTransportConfig, options?: HttpTransportOptions);
  constructor(
    private config: HttpTransportConfig,
    options: HttpTransportOptions | string = {}
  ) {
    const resolvedOptions = typeof options === 'string' ? { sdkHeaderEntry: options } : options;
    const httpClient = resolvedOptions.sdkHeaderEntry
      ? new HttpClient(config, {}, resolvedOptions.sdkHeaderEntry)
      : new HttpClient(config);
    this.httpClient = httpClient;
    this.agentInstanceClient = new AgentInstanceClient(httpClient);
    this.agentSpanClient = new AgentSpanClient(httpClient);
    this.onFatalError = resolvedOptions.failureHandling?.onFatalError;
    this.latestAgentIdentifier = config.agentIdentifier;
    this.taskExecutor = new TaskExecutor(this.actionQueue, this.processAction, {
      workerCount: 1,
      onError: async (error) => {
        logger.error('Error processing HTTP action:', error);
      },
    });
    this.taskExecutor.start();
  }

  /**
   * Registers a callback that fires when any span response contains a
   * termination control signal. Called by createCore to wire the monitor.
   */
  registerControlSignalCallback(fn: (reason: string | null) => void): void {
    this.controlSignalCallback = fn;
  }

  registerSchema(schema: Record<string, unknown>): void {
    this.assertUsable('agent_register');

    const incomingSchema = JSON.stringify(schema);
    if (this.previousAgentSchema !== null && this.previousAgentSchema !== incomingSchema) {
      this.schemaRevision += 1;
      this.requiresNewAgentIdentifier = true;
      this.previousAgentIdentifier = this.latestAgentIdentifier ?? this.config.agentIdentifier;
      this.agentInstanceId = null;
      this.currentAgentRegisterIdempotencyKey = null;
      this.cancelScheduledRetriesForOperation('agent_start');
      this.clearTransientFailuresForOperation('agent_start');
    } else if (this.previousAgentSchema === null) {
      this.schemaRevision = 1;
    }

    this.previousAgentSchema = incomingSchema;
    this.config.agentSchema = schema;
  }

  startAgentInstance(options?: AgentInstanceOptions): void {
    this.assertUsable('agent_start');
    this.assertSchemaIdentifier(options?.agentIdentifier);
    this.latestAgentIdentifier = options?.agentIdentifier ?? this.latestAgentIdentifier;
    this.enqueue({
      type: 'agent_start',
      options,
      schemaRevision: this.schemaRevision,
      idempotencyKey: createActionIdempotencyKey(),
      retryAttempt: 0,
    });
  }

  finishAgentInstance(): void {
    this.assertUsable('agent_finish');
    this.enqueue({
      type: 'agent_finish',
      idempotencyKey: createActionIdempotencyKey(),
      retryAttempt: 0,
    });
  }

  emit(span: Span): void {
    this.assertUsable('span_create');
    this.enqueue({
      type: 'span_end',
      span,
      idempotencyKey: createActionIdempotencyKey(),
      retryAttempt: 0,
    });
  }

  finishSpan(spanId: string, endTime: number, options?: FinishSpanOptions): void {
    this.assertUsable('span_finish');
    this.enqueue({
      type: 'span_finish',
      spanId,
      endTime,
      status: options?.status,
      resultPayload: options?.resultPayload,
      idempotencyKey: createActionIdempotencyKey(),
      retryAttempt: 0,
    });
  }

  assertUsable(operation: PrefactorTransportOperation): void {
    if (this.fatalError) {
      throw this.fatalError;
    }

    if (this.closed || this.healthState === 'closed') {
      this.droppedAfterClose += 1;
      throw this.createQueueClosedError(operation);
    }
  }

  getHealthState(): PrefactorTransportHealthState {
    return this.healthState;
  }

  getAgentInstanceId(): string | null {
    return this.agentInstanceId;
  }

  getHttpRequester(): HttpRequester {
    return this.httpClient;
  }

  async close(): Promise<void> {
    if (this.healthState === 'closed') {
      return;
    }

    this.closed = true;
    this.healthState = 'closed';

    const cancelledTimers = this.retryTimers.size;
    for (const timer of this.retryTimers.keys()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.cancelledScheduledRetries += cancelledTimers;

    await this.taskExecutor.stop();

    const details = {
      droppedAfterClose: this.droppedAfterClose,
      cancelledScheduledRetries: this.cancelledScheduledRetries,
      unresolvedPendingFinishes: this.pendingFinishes.size,
      unresolvedParentReferences: this.pendingChildren.size,
      partialTelemetryEvents: this.partialTelemetryEvents,
    };

    if (details.unresolvedPendingFinishes > 0) {
      logger.warn(
        `Transport closed with ${details.unresolvedPendingFinishes} pending span finish(es) that could not be processed`
      );
    }

    if (details.unresolvedParentReferences > 0) {
      logger.warn(
        `Transport closed with ${details.unresolvedParentReferences} unresolved parent span reference(s)`
      );
    }

    if (details.cancelledScheduledRetries > 0) {
      logger.warn(
        `Transport closed with ${details.cancelledScheduledRetries} scheduled retry action(s) cancelled`
      );
    }

    if (details.droppedAfterClose > 0) {
      logger.warn(
        `Transport dropped ${details.droppedAfterClose} action(s) after shutdown had already started`
      );
    }

    this.pendingFinishes.clear();
    this.pendingChildren.clear();

    if (
      details.droppedAfterClose > 0 ||
      details.cancelledScheduledRetries > 0 ||
      details.unresolvedPendingFinishes > 0 ||
      details.unresolvedParentReferences > 0 ||
      details.partialTelemetryEvents > 0
    ) {
      const kind =
        details.droppedAfterClose > 0 || details.cancelledScheduledRetries > 0
          ? 'dropped_on_shutdown'
          : 'partial_telemetry';
      throw new PrefactorShutdownError(
        kind,
        kind === 'dropped_on_shutdown'
          ? 'Transport shutdown dropped telemetry before it could be flushed.'
          : 'Transport shutdown completed with partial telemetry loss.',
        {
          operation: 'shutdown',
          consecutiveFailures: 0,
          responseBody: details,
          details,
        }
      );
    }
  }

  private enqueue(action: TransportAction): void {
    if (this.fatalError) {
      throw this.fatalError;
    }

    if (this.closed) {
      this.droppedAfterClose += 1;
      throw this.createQueueClosedError(operationForAction(action));
    }

    this.actionQueue.put(action).catch((error: unknown) => {
      this.droppedAfterClose += 1;
      logger.error('Failed to enqueue HTTP action:', error);
    });
  }

  private processAction = async (action: TransportAction): Promise<void> => {
    // Once the transport is fatal, queued follow-up work should be ignored rather than
    // generating secondary partial-telemetry noise.
    if (this.fatalError) {
      return;
    }

    switch (action.type) {
      case 'agent_start':
        await this.processAgentStart(action);
        return;
      case 'agent_finish':
        await this.processAgentFinish(action);
        return;
      case 'span_end':
        await this.processSpanCreate(action);
        return;
      case 'span_finish':
        await this.processSpanFinish(action);
        return;
    }
  };

  private async processAgentStart(action: AgentStartAction): Promise<void> {
    if (this.isStaleAgentStartAction(action)) {
      logger.warn(
        `Dropping stale agent_start action for schema revision ${action.schemaRevision}; current revision is ${this.schemaRevision}`
      );
      this.recordActionSuccess(action);
      return;
    }

    try {
      await this.startAgentInstanceHttp(action);
      this.recordActionSuccess(action);
    } catch (error) {
      this.handleActionError('agent_start', action, error);
    }
  }

  private async processAgentFinish(action: AgentFinishAction): Promise<void> {
    try {
      await this.finishAgentInstanceHttp(action);
      this.recordActionSuccess(action);
    } catch (error) {
      this.handleActionError('agent_finish', action, error);
    }
  }

  private async processSpanCreate(action: SpanEndAction): Promise<void> {
    try {
      await this.sendSpan(action);
    } catch (error) {
      this.handleActionError('span_create', action, error);
    }
  }

  private async processSpanFinish(action: SpanFinishAction): Promise<void> {
    if (!this.spanIdMap.has(action.spanId)) {
      this.pendingFinishes.set(action.spanId, action);
      return;
    }

    try {
      await this.finishSpanHttp(action);
      this.deletePendingFinishIfTracked(action);
    } catch (error) {
      try {
        this.handleActionError('span_finish', action, error);
        this.deletePendingFinishIfTracked(action);
      } catch (unexpectedError) {
        if (this.pendingFinishes.get(action.spanId) !== action) {
          this.pendingFinishes.set(action.spanId, action);
        }
        throw unexpectedError;
      }
    }
  }

  private handleActionError(
    operation: PrefactorTransportOperation,
    action: RetryableAction,
    error: unknown
  ): void {
    const classification = this.classifyFailure(operation, error);

    if (classification.type === 'fatal') {
      this.enterFatalState(classification.error);
      return;
    }

    if (classification.type === 'transient') {
      if (classification.kind !== 'agent_not_found') {
        this.enterFatalState(
          this.createRetryExhaustedError(
            operation,
            action,
            classification.kind,
            classification.error
          )
        );
        return;
      }

      this.scheduleRetry(action, classification.kind, classification.error);
      return;
    }

    throw error;
  }

  private classifyFailure(
    operation: PrefactorTransportOperation,
    error: unknown
  ): FailureClassification {
    if (error instanceof PrefactorFatalError) {
      return {
        type: 'fatal',
        error,
      };
    }

    if (!(error instanceof HttpClientError)) {
      return { type: 'unexpected' };
    }

    if (isAgentNotFoundFailure(operation, error)) {
      return {
        type: 'transient',
        kind: 'agent_not_found',
        error,
      };
    }

    if (error.status === 401 || error.status === 403) {
      return {
        type: 'fatal',
        error: new PrefactorFatalError(
          'auth',
          'Authentication failed while sending Prefactor telemetry.',
          {
            operation,
            status: error.status,
            responseBody: error.responseBody,
            consecutiveFailures: 1,
            cause: error,
          }
        ),
      };
    }

    if (error.status === undefined) {
      return {
        type: 'transient',
        kind: 'network',
        error,
      };
    }

    if (error.status === 429) {
      return {
        type: 'transient',
        kind: 'rate_limit',
        error,
      };
    }

    if (error.status >= 500) {
      return {
        type: 'transient',
        kind: 'backend_transient',
        error,
      };
    }

    if (error.status >= 400) {
      return {
        type: 'fatal',
        error: new PrefactorFatalError(
          'contract',
          'Prefactor backend rejected telemetry due to a contract or validation error.',
          {
            operation,
            status: error.status,
            responseBody: error.responseBody,
            consecutiveFailures: 1,
            cause: error,
          }
        ),
      };
    }

    return { type: 'unexpected' };
  }

  private scheduleRetry(
    action: RetryableAction,
    kind: TransientFailureKind,
    error: HttpClientError
  ): void {
    if (this.closed || this.fatalError) {
      return;
    }

    const operation = operationForAction(action);
    const key = transientFailureKey(operation, kind);
    const consecutiveFailures = (this.transientFailureCounts.get(key) ?? 0) + 1;
    this.transientFailureCounts.set(key, consecutiveFailures);
    this.healthState = 'degraded';

    if (action.retryAttempt >= this.config.maxRetries) {
      this.enterFatalState(this.createRetryExhaustedError(operation, action, kind, error));
      return;
    }

    const nextAction = {
      ...action,
      retryAttempt: action.retryAttempt + 1,
      transientKind: kind,
    };
    const delayMs = calculateRetryDelay(action.retryAttempt, this.config);

    logger.warn(
      `Retrying ${operation} after transient ${kind} failure (attempt ${nextAction.retryAttempt}) in ${delayMs}ms`
    );

    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);

      if (this.closed || this.fatalError) {
        return;
      }

      try {
        this.enqueue(nextAction);
      } catch (error) {
        if (!(error instanceof PrefactorFatalError)) {
          logger.error('Failed to enqueue scheduled HTTP retry:', error);
        }
      }
    }, delayMs);

    this.retryTimers.set(timer, { operation });
  }

  private recordActionSuccess(action: RetryableAction): void {
    if (action.transientKind) {
      this.transientFailureCounts.delete(
        transientFailureKey(operationForAction(action), action.transientKind)
      );
    }

    if (this.healthState === 'degraded' && this.transientFailureCounts.size === 0) {
      this.healthState = 'healthy';
    }
  }

  private clearTransientFailuresForOperation(operation: PrefactorTransportOperation): void {
    for (const key of this.transientFailureCounts.keys()) {
      if (key.startsWith(`${operation}:`)) {
        this.transientFailureCounts.delete(key);
      }
    }

    if (this.healthState === 'degraded' && this.transientFailureCounts.size === 0) {
      this.healthState = 'healthy';
    }
  }

  private cancelScheduledRetriesForOperation(operation: PrefactorTransportOperation): void {
    for (const [timer, metadata] of this.retryTimers) {
      if (metadata.operation !== operation) {
        continue;
      }

      clearTimeout(timer);
      this.retryTimers.delete(timer);
    }
  }

  private enterFatalState(error: PrefactorFatalError): PrefactorFatalError {
    if (this.fatalError) {
      return this.fatalError;
    }

    this.fatalError = error;
    this.healthState = 'fatal';
    logger.error('Transport entered a fatal failure state.', {
      kind: error.kind,
      operation: error.operation,
      status: error.status,
      consecutiveFailures: error.consecutiveFailures,
    });

    if (!this.fatalErrorNotified) {
      this.fatalErrorNotified = true;
      try {
        this.onFatalError?.(error);
      } catch (callbackError) {
        logger.error('Fatal error callback failed:', callbackError);
      }
    }

    return error;
  }

  private createRetryExhaustedError(
    operation: PrefactorTransportOperation,
    action: RetryableAction,
    kind: TransientFailureKind,
    error: HttpClientError
  ): PrefactorFatalError {
    const retryAttempt = kind === 'agent_not_found' ? action.retryAttempt : this.config.maxRetries;
    const consecutiveFailures =
      kind === 'agent_not_found' ? action.retryAttempt + 1 : this.config.maxRetries + 1;

    return new PrefactorFatalError(
      'retry_exhausted',
      'Prefactor transport exhausted its retry budget after transient failures.',
      {
        operation,
        status: error.status,
        responseBody: {
          transientKind: kind,
          retryAttempt,
          responseBody: error.responseBody,
        },
        consecutiveFailures,
        cause: error,
      }
    );
  }

  private assertSchemaIdentifier(nextAgentIdentifier: string | undefined): void {
    if (!this.requiresNewAgentIdentifier) {
      return;
    }

    if (nextAgentIdentifier !== undefined && nextAgentIdentifier !== this.previousAgentIdentifier) {
      return;
    }

    throw this.enterFatalState(
      new PrefactorFatalError(
        'schema_drift',
        'Schema changed; starting an agent requires a new agentIdentifier value.',
        {
          operation: 'agent_start',
          responseBody: {
            previousAgentIdentifier: this.previousAgentIdentifier,
          },
          consecutiveFailures: 1,
        }
      )
    );
  }

  private isStaleAgentStartAction(action: AgentStartAction): boolean {
    return action.schemaRevision !== this.schemaRevision;
  }

  private async processPendingFinishes(spanId: string): Promise<void> {
    const pendingFinish = this.pendingFinishes.get(spanId);
    if (pendingFinish === undefined) {
      return;
    }

    await this.processSpanFinish(pendingFinish);
  }

  private queuePendingChild(parentSpanId: string, childAction: SpanEndAction): void {
    const existingChildren = this.pendingChildren.get(parentSpanId) ?? [];
    existingChildren.push(childAction);
    this.pendingChildren.set(parentSpanId, existingChildren);
  }

  private async processPendingChildren(parentSpanId: string): Promise<void> {
    const waitingChildren = this.pendingChildren.get(parentSpanId);
    if (!waitingChildren || waitingChildren.length === 0) {
      return;
    }

    this.pendingChildren.delete(parentSpanId);
    for (let index = 0; index < waitingChildren.length; index += 1) {
      const childAction = waitingChildren[index];

      try {
        await this.processSpanCreate(childAction);
      } catch (error) {
        const remainingChildren = waitingChildren.slice(index);
        this.pendingChildren.set(parentSpanId, remainingChildren);
        throw error;
      }

      if (this.fatalError) {
        return;
      }
    }
  }

  private transformSpanToApiFormat(span: Span): AgentSpanCreatePayload {
    const startedAt = new Date(span.startTime).toISOString();
    const finishedAt = span.endTime ? new Date(span.endTime).toISOString() : null;
    const apiStatus = this.mapStatusForApi(span.status);
    const resultPayload = apiStatus === 'active' ? undefined : buildSpanResultPayload(span);

    const payload: Record<string, unknown> = {
      span_id: span.spanId,
      trace_id: span.traceId,
      name: span.name,
      status: apiStatus,
      inputs: span.inputs,
      outputs: span.outputs,
      metadata: span.metadata,
      token_usage: null,
      error: null,
    };

    if (span.tokenUsage) {
      payload.token_usage = {
        prompt_tokens: span.tokenUsage.promptTokens,
        completion_tokens: span.tokenUsage.completionTokens,
        total_tokens: span.tokenUsage.totalTokens,
      };
    }

    if (span.error) {
      payload.error = {
        error_type: span.error.errorType,
        message: span.error.message,
        stacktrace: span.error.stacktrace,
      };
    }

    const parentSpanId = span.parentSpanId ? (this.spanIdMap.get(span.parentSpanId) ?? null) : null;

    return {
      details: {
        agent_instance_id: this.agentInstanceId,
        schema_name: span.spanType,
        status: apiStatus,
        payload,
        result_payload: resultPayload,
        parent_span_id: parentSpanId,
        started_at: startedAt,
        finished_at: finishedAt,
      },
    };
  }

  private mapStatusForApi(status: Span['status']): AgentSpanStatus {
    switch (status) {
      case 'running':
        return 'active';
      case 'success':
        return 'complete';
      case 'error':
        return 'failed';
      default:
        return 'active';
    }
  }

  private buildAgentRegisterPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    if (this.config.agentId) {
      payload.agent_id = this.config.agentId;
    }

    if (this.config.agentIdentifier) {
      payload.agent_version = {
        external_identifier: this.config.agentIdentifier,
        name: this.config.agentName || 'Agent',
        description: this.config.agentDescription || '',
      };
    }

    if (this.config.agentSchema) {
      payload.agent_schema_version = this.config.agentSchema;
    }

    return payload;
  }

  private async ensureAgentRegistered(): Promise<void> {
    if (this.agentInstanceId) {
      return;
    }

    this.currentAgentRegisterIdempotencyKey ??= createActionIdempotencyKey();

    const data = await this.agentInstanceClient.register({
      ...this.buildAgentRegisterPayload(),
      idempotency_key: this.currentAgentRegisterIdempotencyKey,
    });

    const backendAgentInstanceId = data.details?.id;
    if (!backendAgentInstanceId) {
      throw new PrefactorFatalError(
        'contract',
        'Prefactor agent registration response was missing details.id.',
        {
          operation: 'agent_register',
          responseBody: data,
          consecutiveFailures: 1,
        }
      );
    }

    this.agentInstanceId = backendAgentInstanceId;
    this.currentAgentRegisterIdempotencyKey = null;
  }

  private async startAgentInstanceHttp(action: AgentStartAction): Promise<void> {
    if (action.options?.agentId !== undefined) {
      this.config.agentId = action.options.agentId;
    }
    if (action.options?.agentIdentifier !== undefined) {
      this.config.agentIdentifier = action.options.agentIdentifier;
      this.latestAgentIdentifier = action.options.agentIdentifier;
      if (this.requiresNewAgentIdentifier && action.schemaRevision === this.schemaRevision) {
        this.requiresNewAgentIdentifier = false;
        this.previousAgentIdentifier = null;
        this.currentAgentRegisterIdempotencyKey = null;
      }
    }
    if (action.options?.agentName !== undefined) {
      this.config.agentName = action.options.agentName;
    }
    if (action.options?.agentDescription !== undefined) {
      this.config.agentDescription = action.options.agentDescription;
    }

    await this.ensureAgentRegistered();
    if (!this.agentInstanceId) {
      this.recordPartialTelemetry('Cannot start agent instance: not registered');
      return;
    }

    await this.agentInstanceClient.start(this.agentInstanceId, {
      idempotency_key: action.idempotencyKey,
    });
  }

  private async finishAgentInstanceHttp(action: AgentFinishAction): Promise<void> {
    if (!this.agentInstanceId) {
      this.recordPartialTelemetry('Cannot finish agent instance: not registered');
      return;
    }

    try {
      await this.agentInstanceClient.finish(this.agentInstanceId, {
        idempotency_key: action.idempotencyKey,
      });
    } catch (error) {
      // 409 means the instance is already in a terminal state (e.g. terminated).
      // Treat as success — the instance is done either way.
      if (error instanceof HttpClientError && error.status === 409) {
        logger.debug(`Agent instance ${this.agentInstanceId} already in terminal state; skipping finish.`);
      } else {
        throw error;
      }
    }

    this.agentInstanceId = null;
    this.currentAgentRegisterIdempotencyKey = null;
  }

  private async sendSpan(action: SpanEndAction): Promise<void> {
    if (!this.agentInstanceId) {
      await this.ensureAgentRegistered();
    }

    if (action.span.parentSpanId && !this.spanIdMap.has(action.span.parentSpanId)) {
      this.queuePendingChild(action.span.parentSpanId, action);
      return;
    }

    const response = await this.agentSpanClient.create({
      ...this.transformSpanToApiFormat(action.span),
      idempotency_key: action.idempotencyKey,
    });

    this.checkControlSignal(response.control);

    const backendSpanId = response.details?.id;

    if (!backendSpanId) {
      this.recordPartialTelemetry(
        `Span create response for ${action.span.spanId} was missing details.id`
      );
      this.recordActionSuccess(action);
      return;
    }

    this.spanIdMap.set(action.span.spanId, backendSpanId);
    this.recordActionSuccess(action);
    await this.processPendingFinishes(action.span.spanId);
    if (this.fatalError) {
      return;
    }
    await this.processPendingChildren(action.span.spanId);
  }

  private async finishSpanHttp(action: SpanFinishAction): Promise<void> {
    const backendSpanId = this.spanIdMap.get(action.spanId);
    if (!backendSpanId) {
      this.recordPartialTelemetry(`Cannot finish span ${action.spanId}: backend ID not found`);
      this.recordActionSuccess(action);
      return;
    }

    const finishResponse = await this.agentSpanClient.finish(
      backendSpanId,
      new Date(action.endTime).toISOString(),
      {
        status: action.status,
        result_payload: action.resultPayload ?? {},
        idempotency_key: action.idempotencyKey,
      }
    );

    this.checkControlSignal(finishResponse.control);
    this.recordActionSuccess(action);
  }

  private checkControlSignal(
    control: { terminate?: boolean; reason?: string | null } | undefined
  ): void {
    if (control?.terminate && this.controlSignalCallback) {
      this.controlSignalCallback(control.reason ?? null);
    }
  }

  private recordPartialTelemetry(message: string): void {
    this.partialTelemetryEvents += 1;
    logger.warn(message);
  }

  private deletePendingFinishIfTracked(action: SpanFinishAction): void {
    if (this.pendingFinishes.get(action.spanId) === action) {
      this.pendingFinishes.delete(action.spanId);
    }
  }

  private createQueueClosedError(operation: PrefactorTransportOperation): PrefactorFatalError {
    return new PrefactorFatalError(
      'queue_closed',
      'Prefactor transport queue is closed and cannot accept more telemetry.',
      {
        operation,
        consecutiveFailures: 1,
      }
    );
  }
}

function createActionIdempotencyKey(): string {
  return ensureIdempotencyKey();
}

function operationForAction(action: TransportAction): PrefactorTransportOperation {
  switch (action.type) {
    case 'agent_start':
      return 'agent_start';
    case 'agent_finish':
      return 'agent_finish';
    case 'span_end':
      return 'span_create';
    case 'span_finish':
      return 'span_finish';
  }
}

function transientFailureKey(
  operation: PrefactorTransportOperation,
  kind: TransientFailureKind
): string {
  return `${operation}:${kind}`;
}

function isAgentNotFoundFailure(
  operation: PrefactorTransportOperation,
  error: HttpClientError
): boolean {
  if (
    operation !== 'agent_register' &&
    operation !== 'agent_start' &&
    operation !== 'agent_finish'
  ) {
    return false;
  }

  if (error.status !== 404) {
    return false;
  }

  const responseText = JSON.stringify(error.responseBody ?? '').toLowerCase();
  return (
    responseText.includes('not_found') ||
    responseText.includes('not found') ||
    (responseText.includes('agent') && responseText.includes('missing'))
  );
}
