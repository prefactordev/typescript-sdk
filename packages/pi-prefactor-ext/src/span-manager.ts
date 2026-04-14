/**
 * Span Manager for pi-prefactor-ext
 *
 * Manages span lifecycle: creation, tracking, finishing, and duration calculation.
 * Uses Prefactor API client from Phase 2.
 *
 * @module
 */

import type { Logger } from './logger.js';
import type { PrefactorClient } from './prefactor-client.js';
import type { SpanSchemaName, AnySpanPayload, AnySpanResult } from './schemas.js';

/**
 * Tracked span metadata
 */
interface TrackedSpan {
  schemaName: SpanSchemaName;
  startTime: number;
  parentSpanId?: string | null;
  payload: AnySpanPayload;
  status: 'active' | 'finished';
  spanId: string;
  /** Enriched result payload set by event handlers (e.g., message_end).
   *  Used by finishAllSpans to avoid overwriting detailed results with generic ones. */
  pendingResult?: AnySpanResult;
}

/**
 * Span Manager interface
 */
export interface SpanManager {
  setInstanceId(instanceId: string): void;
  createSpan(
    schemaName: SpanSchemaName,
    payload: AnySpanPayload,
    parentSpanId?: string | null
  ): Promise<string | null>;
  finishSpan(
    spanId: string,
    resultPayload: AnySpanResult,
    durationMs?: number
  ): Promise<boolean>;
  getSpan(spanId: string): TrackedSpan | undefined;
  setPendingResult(spanId: string, result: AnySpanResult): void;
  finishAllSpans(status?: 'complete' | 'failed' | 'cancelled'): Promise<void>;
  getActiveSpanCount(): number;
}

/**
 * Span Manager implementation
 *
 * Features:
 * - Active span tracking with metadata
 * - Duration calculation from start time
 * - Parent-child relationship validation
 * - Graceful error handling (log and continue)
 */
export class SpanManagerImpl implements SpanManager {
  private client: PrefactorClient;
  private logger: Logger;
  private activeSpans: Map<string, TrackedSpan> = new Map();
  private instanceId: string | null = null;

  constructor(client: PrefactorClient, logger: Logger) {
    this.client = client;
    this.logger = logger;

    logger.debug('span_manager_init');
  }

  /**
   * Set the agent instance ID for span creation
   */
  setInstanceId(instanceId: string): void {
    this.instanceId = instanceId;
    this.logger.debug('span_manager_instance_set', { instanceId });
  }

  /**
   * Create a new span and track it locally
   *
   * @param schemaName - Span schema name (e.g., 'pi:session', 'pi:agent_run')
   * @param payload - Span payload data
   * @param parentSpanId - Optional parent span ID for hierarchy
   * @returns Span ID if successful, null otherwise
   */
  async createSpan(
    schemaName: SpanSchemaName,
    payload: AnySpanPayload,
    parentSpanId?: string | null
  ): Promise<string | null> {
    if (!this.instanceId) {
      this.logger.error('create_span_no_instance', { schemaName });
      return null;
    }

    const startTime = Date.now();

    try {
      // Create span via Prefactor API
      const result = await this.client.createSpan(this.instanceId, schemaName, payload, parentSpanId);

      if (!result || !result.spanId) {
        this.logger.error('create_span_api_failed', { schemaName });
        return null;
      }

      const spanId = result.spanId;

      // Track span locally
      const trackedSpan: TrackedSpan = {
        schemaName,
        startTime,
        parentSpanId,
        payload,
        status: 'active',
        spanId,
      };

      this.activeSpans.set(spanId, trackedSpan);

      this.logger.debug('span_created', {
        spanId,
        schemaName,
        parentSpanId,
        startTime,
      });

      return spanId;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('create_span_error', { schemaName, error });
      return null;
    }
  }

  /**
   * Finish a span and remove it from tracking
   *
   * @param spanId - Span ID to finish
   * @param resultPayload - Result payload data
   * @param durationMs - Optional duration override (calculated if not provided)
   * @returns true if successful, false otherwise
   */
  async finishSpan(
    spanId: string,
    resultPayload: AnySpanResult,
    durationMs?: number
  ): Promise<boolean> {
    const trackedSpan = this.activeSpans.get(spanId);

    if (!trackedSpan) {
      this.logger.warn('finish_span_not_found', { spanId });
      return false;
    }

    // Calculate duration if not provided
    const calculatedDuration = durationMs ?? (Date.now() - trackedSpan.startTime);

    try {
      // Finish span via Prefactor API
      const success = await this.client.finishSpan(spanId, resultPayload, calculatedDuration);

      if (!success) {
        this.logger.error('finish_span_api_failed', { spanId });
        return false;
      }

      // Update local tracking
      trackedSpan.status = 'finished';
      this.activeSpans.delete(spanId);

      this.logger.debug('span_finished', {
        spanId,
        schemaName: trackedSpan.schemaName,
        durationMs: calculatedDuration,
      });

      return true;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('finish_span_error', { spanId, error });
      return false;
    }
  }

  /**
   * Get tracked span metadata
   *
   * @param spanId - Span ID to retrieve
   * @returns Span metadata if tracked, undefined otherwise
   */
  getSpan(spanId: string): TrackedSpan | undefined {
    return this.activeSpans.get(spanId);
  }

  /**
   * Store a pending result payload for a span.
   * Used by event handlers (e.g., message_end) to set the rich result payload
   * BEFORE the async finishSpan call completes. If finishAllSpans runs first
   * (due to race with session_shutdown), it will use this pending result
   * instead of the generic one.
   */
  setPendingResult(spanId: string, result: AnySpanResult): void {
    const trackedSpan = this.activeSpans.get(spanId);
    if (trackedSpan) {
      trackedSpan.pendingResult = result;
      this.logger.debug('pending_result_set', { spanId, schemaName: trackedSpan.schemaName });
    }
  }

  /**
   * Finish all active spans with specified status
   * Used for cleanup on session end or error
   *
   * @param status - Status to use for unfinished spans (default: 'failed')
   */
  async finishAllSpans(status: 'complete' | 'failed' | 'cancelled' = 'failed'): Promise<void> {
    const activeCount = this.activeSpans.size;

    if (activeCount === 0) {
      this.logger.debug('finish_all_spans_no_active_spans');
      return;
    }

    this.logger.info('finish_all_spans_start', { count: activeCount, status });

    // Finish in reverse order (LIFO - newest first)
    const spansToFinish = Array.from(this.activeSpans.entries()).sort(
      (a, b) => b[1].startTime - a[1].startTime
    );

    for (const [spanId, trackedSpan] of spansToFinish) {
      try {
        // Re-check: another handler may have already finished this span
        if (!this.activeSpans.has(spanId)) {
          this.logger.debug('finish_all_spans_skip_already_finished', { spanId, schemaName: trackedSpan.schemaName });
          continue;
        }

        // If a handler set a pending result, use it; otherwise use a generic result
        const pendingResult = trackedSpan.pendingResult;
        const resultPayload: AnySpanResult = pendingResult
          ? { ...pendingResult, durationMs: (pendingResult as Record<string, unknown>).durationMs ?? (Date.now() - trackedSpan.startTime) } as AnySpanResult
          : {
              isError: status === 'failed',
              durationMs: Date.now() - trackedSpan.startTime,
            } as AnySpanResult;

        const durationMs = (resultPayload as Record<string, unknown>).durationMs as number | undefined;
        const success = await this.client.finishSpan(spanId, resultPayload, durationMs);

        if (success) {
          this.logger.info('span_finished_cleanup', {
            spanId,
            schemaName: trackedSpan.schemaName,
            age: Date.now() - trackedSpan.startTime,
            status,
          });
        } else {
          // finishSpan returned false — likely a 409 (already finished by a handler)
          // This is expected in the race between message_end and session_shutdown.
          this.logger.debug('span_finish_cleanup_skipped', {
            spanId,
            schemaName: trackedSpan.schemaName,
            reason: 'already_finished',
          });
        }

        // Remove from tracking regardless of success (prevent retry loops)
        this.activeSpans.delete(spanId);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.logger.error('finish_span_cleanup_failed', { spanId, error });
      }
    }

    // Clear all tracking
    this.activeSpans.clear();

    this.logger.info('finish_all_spans_complete', { processed: activeCount });
  }

  /**
   * Get count of currently active spans
   */
  getActiveSpanCount(): number {
    return this.activeSpans.size;
  }

  /**
   * Clear all tracking without finishing spans
   * Use only for emergency cleanup
   */
  clear(): void {
    const count = this.activeSpans.size;
    this.activeSpans.clear();
    this.logger.warn('span_manager_cleared', { count });
  }
}

/**
 * Create a Span Manager instance
 *
 * @param client - Prefactor API client
 * @param logger - Logger instance
 * @returns Span Manager instance
 */
export function createSpanManager(client: PrefactorClient, logger: Logger): SpanManager {
  return new SpanManagerImpl(client, logger);
}
