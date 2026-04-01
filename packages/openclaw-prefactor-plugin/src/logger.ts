// Simple structured logger for prefactor plugin
// Logs to console with [prefactor:<event>] prefix - captured in gateway logs

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
    return `[${timestamp}] [prefactor:${event}] ${dataStr}`;
  }

  debug(event: string, data: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.log(this.format(event, data));
    }
  }

  info(event: string, data: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.log(this.format(event, data));
    }
  }

  warn(event: string, data: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.format(event, data));
    }
  }

  error(event: string, data: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      console.error(this.format(event, data));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export function createLogger(level: LogLevel = 'info'): Logger {
  return new Logger(level);
}
