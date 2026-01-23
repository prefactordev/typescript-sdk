import { generate, generatePartition, type Partition } from '@prefactor/pfid';
import type { Transport } from '../transport/base.js';
import { type Span, SpanStatus, type SpanType, spanTypeRegistry, type TokenUsage } from './span.js';

/**
 * Options for starting a new span
 */
export interface StartSpanOptions {
  /** Name of the span */
  name: string;

  /** Type of operation this span represents */
  spanType: SpanType;

  /** Input data for this operation */
  inputs: Record<string, unknown>;

  /** ID of the parent span (optional) */
  parentSpanId?: string;

  /** Trace ID to use (optional, will generate if not provided) */
  traceId?: string;

  /** Additional metadata (optional) */
  metadata?: Record<string, unknown>;

  /** Tags for categorizing the span (optional) */
  tags?: string[];
}

/**
 * Options for ending a span
 */
export interface EndSpanOptions {
  /** Output data from the operation */
  outputs?: Record<string, unknown>;

  /** Error that occurred (if any) */
  error?: Error;

  /** Token usage information (for LLM calls) */
  tokenUsage?: TokenUsage;
}

/**
 * Options for creating a Tracer
 */
export interface TracerOptions {
  /** Whether to validate span inputs/outputs against registered schemas (default: true) */
  validateSchemas?: boolean;
  /** The partition for ID generation. If not provided, a random partition will be generated. */
  partition?: Partition;
}

/**
 * Tracer manages the lifecycle of spans.
 *
 * The tracer is responsible for:
 * - Creating spans with unique IDs
 * - Managing span lifecycle (start/end)
 * - Delegating to the transport layer for span emission
 * - Handling agent instance lifecycle
 * - Validating span inputs/outputs against registered schemas
 *
 * @example
 * ```typescript
 * const tracer = new Tracer(transport);
 *
 * const span = tracer.startSpan({
 *   name: 'llm-call',
 *   spanType: SpanType.LLM,
 *   inputs: { prompt: 'Hello' }
 * });
 *
 * try {
 *   // ... do work ...
 *   tracer.endSpan(span, { outputs: { response: 'Hi!' } });
 * } catch (error) {
 *   tracer.endSpan(span, { error });
 * }
 * ```
 */
export class Tracer {
  private partition: Partition;
  private validateSchemas: boolean;

  /**
   * Initialize the tracer.
   *
   * @param transport - The transport to use for emitting spans
   * @param options.tracerOptions_or_partition - Options for the tracer (legacy: can pass a Partition directly)
   */
  constructor(
    private transport: Transport,
    tracerOptions_or_partition?: TracerOptions | Partition
  ) {
    // Handle both old signature (Partition directly) and new signature (TracerOptions)
    if (tracerOptions_or_partition !== undefined) {
      // Check if it's TracerOptions by seeing if it has validateSchemas property
      if (
        typeof tracerOptions_or_partition === 'object' &&
        'validateSchemas' in tracerOptions_or_partition &&
        !('then' in tracerOptions_or_partition)
      ) {
        // TracerOptions object - this is the new API
        this.partition = tracerOptions_or_partition.partition ?? generatePartition();
        this.validateSchemas = tracerOptions_or_partition.validateSchemas ?? true;
      } else {
        // Legacy: Partition passed directly
        this.partition = tracerOptions_or_partition as Partition;
        this.validateSchemas = true;
      }
    } else {
      this.partition = generatePartition();
      this.validateSchemas = true;
    }
  }

  /**
   * Start a new span
   *
   * @param options - Span configuration options
   * @returns The created span
   */
  startSpan(options: StartSpanOptions): Span {
    const spanId = generate(this.partition);
    const traceId = options.traceId ?? generate(this.partition);

    const span: Span = {
      spanId,
      parentSpanId: options.parentSpanId ?? null,
      traceId,
      name: options.name,
      spanType: options.spanType,
      startTime: Date.now(),
      endTime: null,
      status: SpanStatus.RUNNING,
      inputs: options.inputs,
      outputs: null,
      tokenUsage: null,
      error: null,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
    };

    // Validate inputs if schema validation is enabled
    if (this.validateSchemas) {
      const validation = spanTypeRegistry.validate(options.spanType, options.inputs, 'input');
      if (!validation.success) {
        console.error(
          `Span input validation failed for span type "${String(options.spanType)}": ${validation.error ?? 'Unknown error'}`
        );
      }
    }

    // AGENT spans are emitted immediately for real-time tracking
    // They will be finished later with finishSpan()
    if (spanTypeRegistry.isAgentSpanType(options.spanType)) {
      try {
        this.transport.emit(span);
      } catch (error) {
        console.error('Failed to emit agent span:', error);
      }
    }

    return span;
  }

  /**
   * End a span and emit it to the transport
   *
   * @param span - The span to end
   * @param options - End span options (outputs, error, token usage)
   */
  endSpan(span: Span, options?: EndSpanOptions): void {
    span.endTime = Date.now();
    span.outputs = options?.outputs ?? null;
    span.tokenUsage = options?.tokenUsage ?? null;

    if (options?.error) {
      span.status = SpanStatus.ERROR;
      span.error = {
        errorType: options.error.constructor.name,
        message: options.error.message,
        stacktrace: options.error.stack ?? '',
      };
    } else {
      span.status = SpanStatus.SUCCESS;

      // Validate outputs if schema validation is enabled and no error occurred
      if (this.validateSchemas && options?.outputs) {
        const validation = spanTypeRegistry.validate(span.spanType, options.outputs, 'output');
        if (!validation.success) {
          console.error(
            `Span output validation failed for span type "${String(span.spanType)}": ${validation.error ?? 'Unknown error'}`
          );
        }
      }
    }

    try {
      // AGENT spans use finishSpan API (they were already emitted on start)
      // Other span types are emitted here
      if (spanTypeRegistry.isAgentSpanType(span.spanType)) {
        this.transport.finishSpan(span.spanId, span.endTime);
      } else {
        this.transport.emit(span);
      }
    } catch (error) {
      console.error('Failed to emit/finish span:', error);
    }
  }

  /**
   * Signal the start of an agent instance execution
   */
  startAgentInstance(): void {
    try {
      this.transport.startAgentInstance();
    } catch (error) {
      console.error('Failed to start agent instance:', error);
    }
  }

  /**
   * Signal the completion of an agent instance execution
   */
  finishAgentInstance(): void {
    try {
      this.transport.finishAgentInstance();
    } catch (error) {
      console.error('Failed to finish agent instance:', error);
    }
  }

  /**
   * Close the tracer and flush any pending spans
   *
   * @returns Promise that resolves when the tracer is closed
   */
  async close(): Promise<void> {
    try {
      await this.transport.close();
    } catch (error) {
      console.error('Failed to close transport:', error);
    }
  }
}
