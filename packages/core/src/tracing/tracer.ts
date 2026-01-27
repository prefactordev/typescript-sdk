import { generate, generatePartition, type Partition } from '@prefactor/pfid';
import type { QueueAction } from '../queue/actions.js';
import type { Queue } from '../queue/base.js';
import { SpanContext } from './context.js';
import type { Span, TokenUsage } from './span.js';
import { SpanStatus, SpanType } from './span.js';

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
 * Tracer manages the lifecycle of spans.
 *
 * The tracer is responsible for:
 * - Creating spans with unique IDs
 * - Managing span lifecycle (start/end)
 * - Delegating to the transport layer for span emission
 * - Handling agent instance lifecycle
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

  /**
   * Initialize the tracer.
   *
   * @param queue - The queue to use for emitting spans
   * @param partition - The partition for ID generation. If not provided, a random partition will be generated.
   */
  constructor(
    private queue: Queue<QueueAction>,
    partition?: Partition
  ) {
    this.partition = partition ?? generatePartition();
  }

  /**
   * Start a new span
   *
   * @param options - Span configuration options
   * @returns The created span
   */
  startSpan(options: StartSpanOptions): Span {
    const parentSpan = SpanContext.getCurrent();
    const spanId = generate(this.partition);
    const traceId = parentSpan?.traceId ?? generate(this.partition);

    const span: Span = {
      spanId,
      parentSpanId: parentSpan?.spanId ?? null,
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

    // AGENT spans are emitted immediately for real-time tracking
    // They will be finished later with finishSpan()
    if (options.spanType === SpanType.AGENT) {
      try {
        this.queue.enqueue({ type: 'span_end', data: span });
      } catch (error) {
        console.error('Failed to enqueue agent span:', error);
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
    const endTime = Date.now();
    span.endTime = endTime;
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
    }

    try {
      // AGENT spans use finishSpan API (they were already emitted on start)
      // Other span types are emitted here
      if (span.spanType === SpanType.AGENT) {
        this.queue.enqueue({ type: 'span_finish', data: { spanId: span.spanId, endTime } });
      } else {
        this.queue.enqueue({ type: 'span_end', data: span });
      }
    } catch (error) {
      console.error('Failed to enqueue span action:', error);
    }
  }

  /**
   * Signal the start of an agent instance execution
   */
  startAgentInstance(): void {
    return;
  }

  /**
   * Signal the completion of an agent instance execution
   */
  finishAgentInstance(): void {
    return;
  }

  /**
   * Close the tracer and flush any pending spans
   *
   * @returns Promise that resolves when the tracer is closed
   */
  async close(): Promise<void> {
    try {
      await this.queue.flush();
    } catch (error) {
      console.error('Failed to flush queue:', error);
    }
  }
}
