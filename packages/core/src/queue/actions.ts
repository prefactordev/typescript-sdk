import type { Span } from '../tracing/span.js';
import type { AgentInstanceOptions, FinishSpanOptions } from '../transport/http.js';

export type SchemaRegisterAction = {
  type: 'schema_register';
  schema: Record<string, unknown>;
};

export type AgentStartAction = {
  type: 'agent_start';
  options?: AgentInstanceOptions;
};

export type AgentFinishAction = {
  type: 'agent_finish';
};

export type SpanEndAction = {
  type: 'span_end';
  span: Span;
};

export type SpanFinishAction = {
  type: 'span_finish';
  spanId: string;
  endTime: number;
} & FinishSpanOptions;

export type TransportAction =
  | SchemaRegisterAction
  | AgentStartAction
  | AgentFinishAction
  | SpanEndAction
  | SpanFinishAction;
