// Custom error classes for HTTP client

import type { ErrorResponse } from './types.js';

export class PrefactorError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number,
    public readonly response?: ErrorResponse,
  ) {
    super(message);
    this.name = 'PrefactorError';
  }
}

export class PrefactorNetworkError extends PrefactorError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message, 'network_error');
    this.name = 'PrefactorNetworkError';
  }
}

export class PrefactorTimeoutError extends PrefactorError {
  constructor(message: string = 'Request timed out') {
    super(message, 'timeout_error');
    this.name = 'PrefactorTimeoutError';
  }
}

export class PrefactorConfigError extends PrefactorError {
  constructor(message: string) {
    super(message, 'config_error');
    this.name = 'PrefactorConfigError';
  }
}
