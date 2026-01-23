/**
 * Branded type for span types
 *
 * This uses a unique symbol to create a nominal type at runtime.
 * Span types can only be created through defineSpanType() or
 * by using the pre-defined SpanType constants.
 */
export type SpanType = string & { readonly __spanTypeBrand: unique symbol };

/**
 * Schema definition for a span type
 *
 * Zod schemas for validating inputs (when starting a span) and outputs (when ending a span).
 * Both schemas are optional.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * const apiFetchSchema = {
 *   input: z.object({ url: z.string() }),
 *   output: z.object({ status: z.number() }),
 * } satisfies SpanTypeSchema;
 * ```
 */
export interface SpanTypeSchema {
  /** Optional schema for validating inputs when starting a span */
  input?: unknown;

  /** Optional schema for validating outputs when ending a span */
  output?: unknown;
}

/**
 * Internal factory function to create branded span types
 */
function createSpanType<T extends string>(type: T): SpanType {
  return type as unknown as SpanType;
}

/**
 * Pre-defined span types for common operations
 */
export const SpanType = {
  AGENT: createSpanType('agent'),
  LLM: createSpanType('llm'),
  TOOL: createSpanType('tool'),
  CHAIN: createSpanType('chain'),
  RETRIEVER: createSpanType('retriever'),
} as const;

/**
 * Define a custom span type
 *
 * Use this function to create branded span types for custom operations.
 * The type will be accepted by the tracer and span APIs.
 *
 * @example
 * ```typescript
 * const DATABASE_SPAN = defineSpanType('database:query');
 * tracer.startSpan({ spanType: DATABASE_SPAN, ... });
 * ```
 *
 * @param type - The string value for the span type
 * @returns A branded span type
 */
export function defineSpanType<T extends string>(type: T): SpanType {
  return type as unknown as SpanType;
}

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

  /** Tags for categorizing and filtering spans */
  tags: string[];
}

/**
 * Registry for tracking known span types at runtime
 *
 * This is opt-in - users can still use any branded span type,
 * but registration enables validation and warnings.
 */
class SpanTypeRegistry {
  private knownTypes = new Set<SpanType>();
  private schemas = new Map<SpanType, SpanTypeSchema>();

  constructor() {
    // Register built-in types by default
    Object.values(SpanType).forEach((type) => void this.register(type));
  }

  /**
   * Register a span type as known
   *
   * @param type - The span type to register
   * @returns The same type for convenience
   */
  register<T extends SpanType>(type: T, schema?: SpanTypeSchema): T {
    this.knownTypes.add(type);
    if (schema) {
      this.schemas.set(type, schema);
    }
    return type;
  }

  /**
   * Check if a span type is registered
   *
   * @param type - The span type to check
   * @returns True if registered, false otherwise
   */
  isKnown(type: SpanType): boolean {
    return this.knownTypes.has(type);
  }

  /**
   * Register multiple span types at once
   *
   * @param types - Array of span types to register
   */
  registerBatch(types: SpanType[]): void {
    types.forEach((type) => void this.register(type));
  }

  /**
   * Get all registered span types
   *
   * @returns Array of registered span types
   */
  getAll(): SpanType[] {
    return Array.from(this.knownTypes);
  }

  /**
   * Check if a span type is an agent type (for special handling)
   *
   * Agent spans are emitted immediately at start, not end.
   * This checks if the type is exactly 'agent' or follows the
   * 'agent:' or ':agent' naming convention.
   *
   * @param type - The span type to check
   * @returns True if this is an agent-type span
   */
  isAgentSpanType(type: SpanType): boolean {
    const typeStr = String(type);
    return typeStr === 'agent' || typeStr.startsWith('agent:') || typeStr.endsWith(':agent');
  }

  /**
   * Get the schema for a span type
   *
   * @param type - The span type to get schema for
   * @returns The schema if registered, undefined otherwise
   */
  getSchema(type: SpanType): SpanTypeSchema | undefined {
    return this.schemas.get(type);
  }

  /**
   * Validate data against a span type's input or output schema
   *
   * @param type - The span type to validate against
   * @param data - The data to validate
   * @param phase - 'input' or 'output' to specify which schema to use
   * @returns Result object with success status and optional error message
   */
  validate(
    type: SpanType,
    data: Record<string, unknown>,
    phase: 'input' | 'output'
  ): { success: boolean; error?: string } {
    const schema = this.schemas.get(type);
    if (!schema) {
      return { success: true };
    }

    const schemaToUse = phase === 'input' ? schema.input : schema.output;
    if (!schemaToUse) {
      return { success: true };
    }

    try {
      (schemaToUse as { parse: (data: unknown) => unknown }).parse(data);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Global registry instance for span types
 *
 * This registry is initialized with all built-in span types.
 * Custom span types can be registered using the registerSpanType() function.
 */
export const spanTypeRegistry = new SpanTypeRegistry();

/**
 * Register a span type in the global registry
 *
 * This function creates a branded span type AND registers it in the
 * global registry. Registered types can be tracked for validation
 * and debugging purposes.
 *
 * @example
 * ```typescript
 * const DATABASE_SPAN = registerSpanType('database:query');
 * tracer.startSpan({ spanType: DATABASE_SPAN, ... });
 * ```
 *
 * @param type - The string value for the span type
 * @returns A branded span type
 */
export function registerSpanType<T extends string>(type: T): SpanType {
  const branded = defineSpanType(type);
  return spanTypeRegistry.register(branded);
}

/**
 * Register a span type with Zod schemas for validation
 *
 * This function creates a branded span type, registers it in the global
 * registry with schemas, and enables automatic validation when creating
 * spans of this type.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * const API_FETCH = registerSpanTypeWithSchema(
 *   'api:fetch-data',
 *   {
 *     input: z.object({
 *       url: z.string().url(),
 *       method: z.enum(['GET', 'POST']),
 *     }),
 *     output: z.object({
 *       status: z.number(),
 *       body: z.string(),
 *     }),
 *   }
 * );
 *
 * // This will validate inputs against the input schema
 * const span = tracer.startSpan({
 *   spanType: API_FETCH,
 *   name: 'fetch',
 *   inputs: { url: 'https://api.example.com', method: 'GET' },
 * });
 *
 * // This will validate outputs against the output schema
 * tracer.endSpan(span, {
 *   outputs: { status: 200, body: 'Success' },
 * });
 * ```
 *
 * @param type - The string value for the span type
 * @param schemas - The input and output schemas for validation
 * @returns A branded span type
 */
export function registerSpanTypeWithSchema<T extends string>(
  type: T,
  schemas: SpanTypeSchema
): SpanType {
  const branded = defineSpanType(type);
  return spanTypeRegistry.register(branded, schemas);
}
