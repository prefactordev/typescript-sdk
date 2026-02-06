// In-memory metrics tracking for prefactor plugin
// Tracks event counts, durations, and session statistics

export interface EventMetrics {
  count: number;
  totalDuration: number;
  lastTimestamp: number | null;
}

export interface MetricsData {
  events: Map<string, EventMetrics>;
  sessions: {
    active: Set<string>;
    totalStarted: number;
    totalEnded: number;
  };
  gateway: {
    startTime: number | null;
    stopTime: number | null;
  };
}

export class Metrics {
  private data: MetricsData;
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
    this.data = {
      events: new Map(),
      sessions: {
        active: new Set(),
        totalStarted: 0,
        totalEnded: 0
      },
      gateway: {
        startTime: null,
        stopTime: null
      }
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  recordEvent(eventName: string, duration?: number): void {
    if (!this.enabled) return;

    const now = Date.now();
    let metrics = this.data.events.get(eventName);
    
    if (!metrics) {
      metrics = {
        count: 0,
        totalDuration: 0,
        lastTimestamp: null
      };
    }

    metrics.count++;
    metrics.lastTimestamp = now;
    if (duration !== undefined) {
      metrics.totalDuration += duration;
    }

    this.data.events.set(eventName, metrics);
  }

  recordSessionStart(sessionKey: string): void {
    if (!this.enabled) return;
    this.data.sessions.active.add(sessionKey);
    this.data.sessions.totalStarted++;
  }

  recordSessionEnd(sessionKey: string): void {
    if (!this.enabled) return;
    this.data.sessions.active.delete(sessionKey);
    this.data.sessions.totalEnded++;
  }

  recordGatewayStart(): void {
    if (!this.enabled) return;
    this.data.gateway.startTime = Date.now();
    this.data.gateway.stopTime = null;
  }

  recordGatewayStop(): void {
    if (!this.enabled) return;
    this.data.gateway.stopTime = Date.now();
  }

  getEventMetrics(eventName: string): EventMetrics | null {
    return this.data.events.get(eventName) || null;
  }

  getAllMetrics(): MetricsData {
    return this.data;
  }

  getSummary(): Record<string, unknown> {
    if (!this.enabled) {
      return { enabled: false };
    }

    const events: Record<string, unknown> = {};
    for (const [name, metrics] of this.data.events) {
      events[name] = {
        count: metrics.count,
        avgDuration: metrics.count > 0 ? metrics.totalDuration / metrics.count : 0,
        lastTimestamp: metrics.lastTimestamp
      };
    }

    return {
      enabled: true,
      events,
      sessions: {
        active: this.data.sessions.active.size,
        totalStarted: this.data.sessions.totalStarted,
        totalEnded: this.data.sessions.totalEnded
      },
      gateway: {
        running: this.data.gateway.startTime !== null && this.data.gateway.stopTime === null,
        startTime: this.data.gateway.startTime,
        uptime: this.data.gateway.startTime && this.data.gateway.stopTime
          ? this.data.gateway.stopTime - this.data.gateway.startTime
          : this.data.gateway.startTime
            ? Date.now() - this.data.gateway.startTime
            : null
      }
    };
  }
}

export function createMetrics(enabled: boolean = true): Metrics {
  return new Metrics(enabled);
}
