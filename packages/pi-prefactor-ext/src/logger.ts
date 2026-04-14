/**
 * Structured logger for pi-prefactor-ext
 *
 * Provides level-based logging with namespace support.
 * Logger never throws - graceful degradation on errors.
 *
 * @module
 */

import type { Config } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

/**
 * Get numeric level for comparison
 */
function getLevelIndex(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

/**
 * Logger interface for structured logging
 */
export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  setLevel(level: LogLevel): void;
}

/**
 * Structured logger implementation
 */
export class PrefactorLogger implements Logger {
  private level: LogLevel;
  private namespace: string;
  private agentId?: string;

  constructor(namespace: string, level: LogLevel = 'silent', agentId?: string) {
    this.namespace = namespace;
    this.level = level;
    this.agentId = agentId;
  }

  private shouldLog(level: LogLevel): boolean {
    return getLevelIndex(level) >= getLevelIndex(this.level);
  }

  private format(level: LogLevel, event: string, data: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const parts = [`[${timestamp}]`, `[${this.namespace}:${level}]`, event];

    if (this.agentId) {
      parts.unshift(`[agent:${this.agentId}]`);
    }

    const dataEntries = Object.entries(data);
    if (dataEntries.length > 0) {
      const dataStr = dataEntries
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');
      parts.push(dataStr);
    }

    return parts.join(' ');
  }

  debug(event: string, data: Record<string, unknown> = {}): void {
    try {
      if (this.shouldLog('debug')) {
        console.log(this.format('debug', event, data));
      }
    } catch {
      // Logger never throws - graceful degradation
    }
  }

  info(event: string, data: Record<string, unknown> = {}): void {
    try {
      if (this.shouldLog('info')) {
        console.log(this.format('info', event, data));
      }
    } catch {
      // Logger never throws - graceful degradation
    }
  }

  warn(event: string, data: Record<string, unknown> = {}): void {
    try {
      if (this.shouldLog('warn')) {
        console.warn(this.format('warn', event, data));
      }
    } catch {
      // Logger never throws - graceful degradation
    }
  }

  error(event: string, data: Record<string, unknown> = {}): void {
    try {
      if (this.shouldLog('error')) {
        console.error(this.format('error', event, data));
      }
    } catch {
      // Logger never throws - graceful degradation
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

/**
 * Create a logger instance
 *
 * @param namespace - Logger namespace (e.g., 'config', 'tracer')
 * @param config - Configuration object (optional, for log level and agent ID)
 * @returns Logger instance
 */
export function getLogger(namespace: string, config?: Partial<Config>): Logger {
  const level = config?.logLevel ?? 'silent';
  const agentId = config?.agentId;
  return new PrefactorLogger(namespace, level, agentId);
}
