/**
 * Log levels for the SDK
 */
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Logger class for the Prefactor SDK
 */
class Logger {
  private static level: LogLevel = (() => {
    const level = process.env.PREFACTOR_LOG_LEVEL?.toUpperCase();
    if (level && level in LogLevel) {
      return LogLevel[level as keyof typeof LogLevel];
    }
    return LogLevel.INFO;
  })();

  constructor(private namespace: string) {}

  debug(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.DEBUG) {
      console.debug(`[prefactor:${this.namespace}] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.INFO) {
      console.info(`[prefactor:${this.namespace}] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.WARN) {
      console.warn(`[prefactor:${this.namespace}] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (Logger.level <= LogLevel.ERROR) {
      console.error(`[prefactor:${this.namespace}] ${message}`, ...args);
    }
  }

  /**
   * Set the global log level
   */
  static setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    const levelMap = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR,
    };
    Logger.level = levelMap[level];
  }
}

/**
 * Get a logger instance for a specific namespace
 *
 * @param namespace - The namespace for this logger
 * @returns Logger instance
 */
export function getLogger(namespace: string): Logger {
  return new Logger(namespace);
}

/**
 * Configure logging based on environment variables
 */
export function configureLogging(): void {
  const level = process.env.PREFACTOR_LOG_LEVEL?.toLowerCase() as
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'
    | undefined;

  if (level) {
    Logger.setLevel(level);
  }
}
