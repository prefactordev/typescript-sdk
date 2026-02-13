import { getActiveTracer } from './active-tracer.js';
import { SpanContext } from './context.js';
import type { StartSpanOptions, Tracer } from './tracer.js';

export async function withSpan<T>(
  tracer: Tracer,
  options: StartSpanOptions,
  fn: () => Promise<T> | T
): Promise<T>;
export async function withSpan<T>(options: StartSpanOptions, fn: () => Promise<T> | T): Promise<T>;
export async function withSpan<T>(
  tracerOrOptions: Tracer | StartSpanOptions,
  optionsOrFn: StartSpanOptions | (() => Promise<T> | T),
  maybeFn?: () => Promise<T> | T
): Promise<T> {
  const { tracer, options, fn } = resolveArgs(tracerOrOptions, optionsOrFn, maybeFn);
  const span = tracer.startSpan(options);

  try {
    const result = await SpanContext.runAsync(span, () => Promise.resolve(fn()));
    tracer.endSpan(span, { outputs: toSpanOutputs(result) });
    return result;
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    tracer.endSpan(span, { error: normalizedError });
    throw error;
  }
}

function toSpanOutputs<T>(result: T): Record<string, unknown> {
  if (isRecord(result)) {
    return result;
  }

  if (result === undefined) {
    return {};
  }

  return { result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resolveArgs<T>(
  tracerOrOptions: Tracer | StartSpanOptions,
  optionsOrFn: StartSpanOptions | (() => Promise<T> | T),
  maybeFn?: () => Promise<T> | T
): {
  tracer: Tracer;
  options: StartSpanOptions;
  fn: () => Promise<T> | T;
} {
  if (maybeFn) {
    return {
      tracer: tracerOrOptions as Tracer,
      options: optionsOrFn as StartSpanOptions,
      fn: maybeFn,
    };
  }

  const tracer = getActiveTracer();
  if (!tracer) {
    throw new Error(
      'No active tracer found. Initialize Prefactor first or pass a tracer explicitly.'
    );
  }

  return {
    tracer,
    options: tracerOrOptions as StartSpanOptions,
    fn: optionsOrFn as () => Promise<T> | T,
  };
}
