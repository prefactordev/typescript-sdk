/**
 * Simple structured logger for pi-prefactor extension
 * Logs to console with [pi-prefactor:<event>] prefix - captured in pi logs
 * 
 * @module
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured logger for diagnostic output.
 * Uses consistent format: [timestamp] [pi-prefactor:event] key=value pairs
 */
export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private format(event: string, data: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const dataStr = Object.entries(data)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    return `[${timestamp}] [pi-prefactor:${event}] ${dataStr}`;
  }

  /**
   * Log debug message (only when level is 'debug')
   */
  debug(event: string, data: Record<string, unknown> = {}): void {
    if (this.shouldLog('debug')) {
      console.log(this.format(event, data));
    }
  }

  /**
   * Log info message (when level is 'debug' or 'info')
   */
  info(event: string, data: Record<string, unknown> = {}): void {
    if (this.shouldLog('info')) {
      console.log(this.format(event, data));
    }
  }

  /**
   * Log warning message (when level is 'debug', 'info', or 'warn')
   */
  warn(event: string, data: Record<string, unknown> = {}): void {
    if (this.shouldLog('warn')) {
      console.warn(this.format(event, data));
    }
  }

  /**
   * Log error message (always logged)
   */
  error(event: string, data: Record<string, unknown> = {}): void {
    if (this.shouldLog('error')) {
      console.error(this.format(event, data));
    }
  }

  /**
   * Change log level dynamically
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

/**
 * Create a logger instance with specified log level
 * 
 * @param level - Minimum log level to output (default: 'info')
 * @returns Logger instance
 */
export function createLogger(level: LogLevel = 'warn'): Logger {
  return new Logger(level);
}
