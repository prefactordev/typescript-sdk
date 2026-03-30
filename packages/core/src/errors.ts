export type PrefactorFatalErrorKind = 'auth' | 'contract' | 'schema_drift' | 'queue_closed';

export type PrefactorShutdownErrorKind = 'partial_telemetry' | 'dropped_on_shutdown';

export type PrefactorTransportOperation =
  | 'agent_register'
  | 'agent_start'
  | 'agent_finish'
  | 'span_create'
  | 'span_finish'
  | 'shutdown';

export type PrefactorTransportHealthState = 'healthy' | 'degraded' | 'fatal' | 'closed';

export interface PrefactorErrorOptions {
  operation: PrefactorTransportOperation;
  status?: number;
  responseBody?: unknown;
  consecutiveFailures?: number;
  cause?: unknown;
}

export class PrefactorFatalError extends Error {
  readonly kind: PrefactorFatalErrorKind;
  readonly operation: PrefactorTransportOperation;
  readonly status?: number;
  readonly responseBody?: unknown;
  readonly consecutiveFailures: number;

  constructor(kind: PrefactorFatalErrorKind, message: string, options: PrefactorErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'PrefactorFatalError';
    this.kind = kind;
    this.operation = options.operation;
    this.status = options.status;
    this.responseBody = options.responseBody;
    this.consecutiveFailures = options.consecutiveFailures ?? 0;
  }
}

export type PrefactorShutdownDetails = {
  droppedAfterClose: number;
  cancelledScheduledRetries: number;
  unresolvedPendingFinishes: number;
  unresolvedParentReferences: number;
  partialTelemetryEvents: number;
};

export class PrefactorShutdownError extends Error {
  readonly kind: PrefactorShutdownErrorKind;
  readonly operation: PrefactorTransportOperation;
  readonly status?: number;
  readonly responseBody?: unknown;
  readonly consecutiveFailures: number;
  readonly details: PrefactorShutdownDetails;

  constructor(
    kind: PrefactorShutdownErrorKind,
    message: string,
    options: PrefactorErrorOptions & { details: PrefactorShutdownDetails }
  ) {
    super(message, { cause: options.cause });
    this.name = 'PrefactorShutdownError';
    this.kind = kind;
    this.operation = options.operation;
    this.status = options.status;
    this.responseBody = options.responseBody;
    this.consecutiveFailures = options.consecutiveFailures ?? 0;
    this.details = options.details;
  }
}

export interface FailureHandlingConfig {
  onFatalError?: (error: PrefactorFatalError) => void;
}
