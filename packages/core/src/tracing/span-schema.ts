import type { JsonSchema } from '../tool-schema.js';
import type { DataRisk } from './data-risk.js';

/**
 * Schema definition for a span type, including its params/result schemas and optional risk metadata.
 */
export interface SpanTypeSchema {
  /** Unique name for this span type (e.g. `langchain:llm`, `myapp:tool:search`). */
  name: string;
  /** JSON Schema describing the span's input params. */
  params_schema: JsonSchema;
  /** JSON Schema describing the span's result payload. */
  result_schema?: JsonSchema;
  /** Liquid template for rendering the span's params as a human-readable summary. */
  template?: string | null;
  /** Liquid template for rendering the span's result as a human-readable summary. */
  result_template?: string | null;
  /** Human-readable description of what this span type represents. */
  description?: string;
  /** Risk metadata describing data sensitivity and permitted actions for this span type. */
  data_risk?: DataRisk;
}

/**
 * Agent schema version payload sent during agent instance registration.
 * Contains the set of span type schemas that define this agent's tracing contract.
 */
export interface AgentSchemaVersion {
  /** External identifier for this schema version (e.g. a semver string or content hash). */
  external_identifier: string;
  /** Array of span type schema definitions. */
  span_type_schemas: SpanTypeSchema[];
}
