import type { Span } from '../tracing/span.js';

export type SchemaRegistration = {
  schemaName: string;
  schemaVersion: string;
  schema: Record<string, unknown>;
};

export type AgentInstanceStart = {
  agentId?: string;
  agentVersion?: string;
  agentName?: string;
  agentDescription?: string;
  schemaName: string;
  schemaVersion: string;
};

export type AgentInstanceFinish = {};

export type QueueAction =
  | { type: 'schema_register'; data: SchemaRegistration }
  | { type: 'agent_start'; data: AgentInstanceStart }
  | { type: 'agent_finish'; data: AgentInstanceFinish }
  | { type: 'span_end'; data: Span }
  | { type: 'span_finish'; data: { spanId: string; endTime: number } };
