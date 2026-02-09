import type { HttpTransportConfig } from '../../config.js';

const JITTER_MIN = 0.5;

export function shouldRetryStatusCode(statusCode: number, retryOnStatusCodes: number[]): boolean {
  return retryOnStatusCodes.includes(statusCode);
}

export function calculateRetryDelay(
  attempt: number,
  config: Pick<
    HttpTransportConfig,
    'initialRetryDelay' | 'maxRetryDelay' | 'retryMultiplier'
  >,
  random: () => number = Math.random
): number {
  const baseDelay = Math.min(
    config.initialRetryDelay * config.retryMultiplier ** attempt,
    config.maxRetryDelay
  );
  const jitterMultiplier = JITTER_MIN + random() * JITTER_MIN;
  return Math.round(baseDelay * jitterMultiplier);
}
