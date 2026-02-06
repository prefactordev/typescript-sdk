import type { Span } from '../tracing/span.js';

export type SchemaRegistration = {
  schema: Record<string, unknown>;
};

export type AgentInstanceStart = {
  agentId?: string;
  agentIdentifier?: string;
  agentName?: string;
  agentDescription?: string;
};

export type AgentInstanceFinish = Record<string, never>;

export type QueueAction =
  | { type: 'schema_register'; data: SchemaRegistration }
  | { type: 'agent_start'; data: AgentInstanceStart }
  | { type: 'agent_finish'; data: AgentInstanceFinish }
  | { type: 'span_end'; data: Span }
  | { type: 'span_finish'; data: { spanId: string; endTime: number } };
