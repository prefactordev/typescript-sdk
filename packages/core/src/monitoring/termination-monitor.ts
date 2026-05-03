import type { HttpRequester } from '../transport/http/http-client.js';

export type TerminationCallback = (reason: string | null) => void;

type AgentInstanceDetail = {
  details?: { status?: string; termination_reason?: string | null };
};

/**
 * Monitors a p2 agent instance for external termination.
 *
 * Once an agent instance ID is available, the monitor polls the p2 API
 * to check if the instance has been terminated externally. When termination
 * is detected, registered callbacks fire and the internal AbortController
 * is signalled so in-flight work can respond.
 */
export class TerminationMonitor {
  private abortController = new AbortController();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private trackingInstanceId: string | null = null;
  private callbacks: TerminationCallback[] = [];
  private destroyed = false;

  constructor(
    private httpClient: HttpRequester,
    private getAgentInstanceId: () => string | null,
    private pollIntervalMs: number = 2000
  ) {}

  /**
   * Checks the current agent instance ID and starts or stops polling accordingly.
   * Call this periodically (or when the instance lifecycle changes) to keep
   * the monitor in sync with the transport.
   */
  sync(): void {
    if (this.destroyed) return;

    const currentId = this.getAgentInstanceId();
    if (currentId === this.trackingInstanceId) return;
    this.trackingInstanceId = currentId ?? null;

    if (currentId) {
      this.startPolling(currentId);
    } else {
      this.stopPolling();
    }
  }

  private startPolling(instanceId: string): void {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      try {
        const response = await this.httpClient.request<AgentInstanceDetail>(
          `/api/v1/agent_instance/${instanceId}`
        );

        if (response?.details?.status === 'terminated') {
          const reason = response.details.termination_reason ?? null;
          this.abortController.abort(reason ?? 'Instance terminated');
          this.stopPolling();
          this.fireCallbacks(reason);
        }
      } catch {
        // Silently continue polling on transient errors
      }
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private fireCallbacks(reason: string | null): void {
    for (const cb of this.callbacks) {
      try {
        cb(reason);
      } catch {
        // Callback errors are silently caught
      }
    }
  }

  onTerminated(callback: TerminationCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== callback);
    };
  }

  /**
   * An AbortSignal that is aborted when termination is detected.
   * Pass this to fetch(), TCPSocket.connect(), or any AbortSignal-aware API
   * to cancel in-flight work when p2 terminates the instance.
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get terminated(): boolean {
    return this.abortController.signal.aborted;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPolling();
    this.callbacks = [];
  }
}
