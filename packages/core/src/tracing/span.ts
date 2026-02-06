/**
 * Types of spans that can be traced
 */
export enum SpanType {
  AGENT = 'agent',
  LLM = 'llm',
  TOOL = 'tool',
  CHAIN = 'chain',
}

/**
 * Default agent schema (v1.0.0) with span schemas for all supported types.
 * Used when no custom schema is provided during registration.
 */
export const DEFAULT_AGENT_SCHEMA: Record<string, unknown> = {
  external_identifier: '1.0.0',
  span_schemas: {
    agent: {
      type: 'object',
      properties: { type: { type: 'string', const: 'agent' } },
    },
    llm: {
      type: 'object',
      properties: { type: { type: 'string', const: 'llm' } },
    },
    tool: {
      type: 'object',
      properties: { type: { type: 'string', const: 'tool' } },
    },
    chain: {
      type: 'object',
      properties: { type: { type: 'string', const: 'chain' } },
    },
  },
};

/**
 * Status of a span
 */
export enum SpanStatus {
  RUNNING = 'running',
  SUCCESS = 'success',
  ERROR = 'error',
}

/**
 * Token usage information for LLM calls
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Error information captured when a span fails
 */
export interface ErrorInfo {
  errorType: string;
  message: string;
  stacktrace: string;
}

/**
 * A span represents a single operation in a trace
 */
export interface Span {
  /** Unique identifier for this span */
  spanId: string;

  /** ID of the parent span, or null if this is a root span */
  parentSpanId: string | null;

  /** Trace ID shared by all spans in a single trace */
  traceId: string;

  /** Human-readable name for this span */
  name: string;

  /** Type of operation this span represents */
  spanType: SpanType;

  /** Start time in milliseconds since Unix epoch */
  startTime: number;

  /** End time in milliseconds since Unix epoch, or null if still running */
  endTime: number | null;

  /** Current status of the span */
  status: SpanStatus;

  /** Input data for this operation */
  inputs: Record<string, unknown>;

  /** Output data from this operation, or null if not completed */
  outputs: Record<string, unknown> | null;

  /** Token usage for LLM calls, or null if not applicable */
  tokenUsage: TokenUsage | null;

  /** Error information if the span failed, or null if successful */
  error: ErrorInfo | null;

  /** Additional metadata about this span */
  metadata: Record<string, unknown>;
}
