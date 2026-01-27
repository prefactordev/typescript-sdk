import { AsyncLocalStorage } from 'node:async_hooks';
import type { Span } from './span.js';

/**
 * Storage for the current span stack in async context
 */
const spanStorage = new AsyncLocalStorage<Span[]>();

/**
 * SpanContext manages the current span in async execution contexts.
 * This enables automatic parent-child span relationships without manual tracking.
 *
 * Uses Node.js AsyncLocalStorage which provides async-safe context propagation.
 *
 * @example
 * ```typescript
 * const span = tracer.startSpan({ name: 'parent', ... });
 *
 * await SpanContext.runAsync(span, async () => {
 *   // Inside this function, getCurrent() returns the parent span
 *   const parent = SpanContext.getCurrent();
 *
 *   const child = tracer.startSpan({
 *     name: 'child',
 *     parentSpanId: parent?.spanId,
 *     traceId: parent?.traceId,
 *   });
 *   // ...
 * });
 * ```
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Intentional API design for namespacing context operations
export class SpanContext {
  /**
   * Get the current span from the async context
   *
   * @returns The current span, or undefined if no span is active
   */
  static getCurrent(): Span | undefined {
    const stack = spanStorage.getStore() ?? [];
    return stack[stack.length - 1];
  }

  /**
   * Get the full span stack from the async context
   */
  static getStack(): Span[] {
    return spanStorage.getStore() ?? [];
  }

  /**
   * Push a span onto the stack for the current async context
   */
  static enter(span: Span): void {
    const stack = [...(spanStorage.getStore() ?? []), span];
    spanStorage.enterWith(stack);
  }

  /**
   * Pop the current span from the stack for the current async context
   */
  static exit(): void {
    const stack = [...(spanStorage.getStore() ?? [])];
    stack.pop();
    spanStorage.enterWith(stack);
  }

  /**
   * Run a synchronous function with the given span as the current context
   *
   * @param span - The span to set as current
   * @param fn - The function to execute
   * @returns The return value of the function
   */
  static run<T>(span: Span, fn: () => T): T {
    const stack = [...(spanStorage.getStore() ?? []), span];
    return spanStorage.run(stack, fn);
  }

  /**
   * Run an asynchronous function with the given span as the current context
   *
   * @param span - The span to set as current
   * @param fn - The async function to execute
   * @returns A promise resolving to the return value of the function
   */
  static async runAsync<T>(span: Span, fn: () => Promise<T>): Promise<T> {
    const stack = [...(spanStorage.getStore() ?? []), span];
    return spanStorage.run(stack, fn);
  }

  /**
   * Clear the current context (primarily for testing)
   */
  static clear(): void {
    spanStorage.disable();
  }
}
