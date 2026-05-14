import type { HttpRequester } from '../transport/http/http-client.js';
import { getLogger } from '../utils/logging.js';

export type TerminationCallback = (reason: string | null) => void;

type AgentInstanceDetail = {
  details?: { status?: string; termination_reason?: string | null };
};

const logger = getLogger('termination-monitor');

/**
 * Monitors a p2 agent instance for external termination.
 *
 * Primary detection: the transport calls `detectTermination()` whenever a
 * span create or finish response contains a control signal. This is fast
 * (detected on the next span API response) and has zero overhead.
 *
 * Fallback detection: slow polling at `pollIntervalMs` (default 30s) covers
 * idle agents that are not actively emitting spans.
 */
export class TerminationMonitor {
  private abortController = new AbortController();
  private callbacks: TerminationCallback[] = [];
  private destroyed = false;
  private generation = 0;
  // After reset(), block detectTermination() until sync() sees a new instance.
  // This prevents stale span responses from the previous run from aborting
  // the fresh signal before the next run has even started.
  private fenced = false;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private trackingInstanceId: string | null = null;
  private fencedInstanceId: string | null = null;
  private sawNullInstanceAfterReset = false;

  constructor(
    private readonly httpClient: HttpRequester,
    private readonly getAgentInstanceId: () => string | null,
    private readonly pollIntervalMs: number = 30_000
  ) {}

  /**
   * Primary termination path — called by the transport when a span response
   * contains a control signal. No polling latency.
   */
  detectTermination(reason: string | null): void {
    if (this.terminated || this.destroyed || this.fenced) return;
    logger.debug(`Termination signalled via span response. Reason: ${reason ?? '(none)'}`);
    this.triggerTermination(reason);
  }

  /**
   * Drives the fallback poll lifecycle. Call periodically (e.g., every 1s)
   * to start or stop polling based on whether an agent instance ID is known.
   */
  sync(): void {
    if (this.destroyed || this.terminated) return;

    const currentId = this.getAgentInstanceId();

    // Lift the post-reset fence only after the old instance disappears or a
    // genuinely different instance starts. A stale old ID can linger for one
    // sync tick after finishCurrentRun().
    if (this.fenced) {
      if (currentId === null) {
        this.sawNullInstanceAfterReset = true;
      } else if (this.sawNullInstanceAfterReset || currentId !== this.fencedInstanceId) {
        this.fenced = false;
        this.fencedInstanceId = null;
        this.sawNullInstanceAfterReset = false;
      } else {
        return;
      }
    }

    if (currentId === this.trackingInstanceId) return;
    this.trackingInstanceId = currentId;

    if (currentId) {
      this.startPolling(currentId);
    } else {
      this.stopPolling();
    }
  }

  onTerminated(callback: TerminationCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== callback);
    };
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get terminated(): boolean {
    return this.abortController.signal.aborted;
  }

  /**
   * Resets the monitor for a new agent run. Clears terminated state, creates a
   * fresh AbortSignal, and stops any in-progress fallback polling. Registered
   * callbacks are preserved.
   */
  reset(): void {
    this.generation++;
    this.fenced = true;
    this.fencedInstanceId = this.trackingInstanceId ?? this.readCurrentInstanceId();
    this.sawNullInstanceAfterReset = false;
    this.stopPolling();
    this.abortController = new AbortController();
    this.trackingInstanceId = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPolling();
    this.callbacks = [];
  }

  private startPolling(instanceId: string): void {
    this.stopPolling();
    const pollGeneration = this.generation;
    this.pollTimer = setInterval(async () => {
      if (this.generation !== pollGeneration || this.terminated || this.destroyed) {
        this.stopPolling();
        return;
      }

      try {
        const response = await this.httpClient.request<AgentInstanceDetail>(
          `/api/v1/agent_instance/${instanceId}`
        );

        if (this.generation !== pollGeneration) return;

        if (response?.details?.status === 'terminated') {
          const reason = response.details.termination_reason ?? null;
          logger.debug(`Termination detected via fallback poll. Reason: ${reason ?? '(none)'}`);
          this.triggerTermination(reason);
        }
      } catch (error) {
        logger.debug('Termination poll failed (will retry):', error);
      }
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private readCurrentInstanceId(): string | null {
    try {
      return this.getAgentInstanceId();
    } catch (error) {
      logger.debug('Failed to read agent instance ID while resetting termination monitor:', error);
      return null;
    }
  }

  private triggerTermination(reason: string | null): void {
    this.abortController.abort(reason ?? 'Instance terminated');
    this.stopPolling();
    this.fireCallbacks(reason);
  }

  private fireCallbacks(reason: string | null): void {
    for (const cb of this.callbacks) {
      try {
        cb(reason);
      } catch (error) {
        logger.error('Termination callback threw:', error);
      }
    }
  }
}
