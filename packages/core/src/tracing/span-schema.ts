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
  /** Liquid template for rendering the span as a human-readable summary. */
  template?: string | null;
  /** Human-readable title. Defaults to `name` when omitted. */
  title?: string;
  /** Human-readable description of what this span type represents. */
  description?: string;
  /** Risk metadata describing data sensitivity and permitted actions for this span type. */
  data_risk?: DataRisk;
}

/**
 * Named schema definition for a quality evaluation.
 *
 * Each entry in `AgentSchemaVersion.quality_schemas` carries a name (the key
 * used when recording quality payloads on an agent instance) alongside the
 * JSON schema, optional display metadata, and data-risk fields.
 *
 * Rendered through the same template machinery as span type schemas.
 */
export interface QualitySchema {
  /** Schema name — the key used when recording quality payloads. */
  name: string;
  /** JSON Schema describing the quality payload shape. */
  schema: JsonSchema;
  /** Human-readable title. Defaults to `name` when omitted. */
  title?: string;
  /** Optional human-readable description. */
  description?: string;
  /** Liquid template for rendering the quality payload as a human-readable summary. */
  template?: string;
  /** Risk metadata describing data sensitivity for quality payloads. */
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
  /** Named quality schemas for instance evaluations. */
  quality_schemas?: QualitySchema[];
}
