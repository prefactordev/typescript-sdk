import type { PrefactorTransportOperation } from '../errors.js';
import type { Span } from '../tracing/span.js';
import type {
  AgentInstanceOptions,
  FinishSpanOptions,
  TransientFailureKind,
} from '../transport/http.js';

type RetryableActionMetadata = {
  idempotencyKey: string;
  retryAttempt: number;
  transientKind?: TransientFailureKind;
  /** Operation that scheduled the retry, when it differs from the action queue type. */
  failureOperation?: PrefactorTransportOperation;
};

export type AgentStartAction = {
  type: 'agent_start';
  options?: AgentInstanceOptions;
  schemaRevision: number;
} & RetryableActionMetadata;

export type AgentFinishAction = {
  type: 'agent_finish';
} & RetryableActionMetadata;

export type SpanEndAction = {
  type: 'span_end';
  span: Span;
} & RetryableActionMetadata;

export type SpanFinishAction = {
  type: 'span_finish';
  spanId: string;
  endTime: number;
} & FinishSpanOptions &
  RetryableActionMetadata;

export type AgentUpdateAction = {
  type: 'agent_update';
  /** Quality evaluation payload for this instance (omit to keep current; null to clear). */
  qualityPayload?: Record<string, unknown> | null;
} & RetryableActionMetadata;

export type TransportAction =
  | AgentStartAction
  | AgentFinishAction
  | AgentUpdateAction
  | SpanEndAction
  | SpanFinishAction;
