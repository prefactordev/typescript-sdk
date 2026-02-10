import type { Span } from './span.js';

export function buildSpanResultPayload(
  span: Pick<Span, 'outputs' | 'error'>
): Record<string, unknown> {
  if (span.error) {
    return {
      error_type: span.error.errorType,
      message: span.error.message,
      stacktrace: span.error.stacktrace,
    };
  }

  return span.outputs ?? {};
}
