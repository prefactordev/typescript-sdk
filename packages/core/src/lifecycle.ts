import type { CoreRuntime } from './create-core.js';
import { clearActiveTracer } from './tracing/active-tracer.js';

const shutdownHandlers = new Map<string, () => void | Promise<void>>();
let activeCoreRuntime: CoreRuntime | null = null;

/**
 * Sets the active runtime used by global shutdown orchestration.
 *
 * @param runtime - Runtime to mark as active, or null to clear.
 */
export function setActiveCoreRuntime(runtime: CoreRuntime | null): void {
  activeCoreRuntime = runtime;
}

/**
 * Registers a shutdown hook for package-level cleanup.
 *
 * @param key - Unique identifier for the handler.
 * @param handler - Cleanup callback executed during `shutdown()`.
 * @returns Function that unregisters the handler.
 */
export function registerShutdownHandler(
  key: string,
  handler: () => void | Promise<void>
): () => void {
  shutdownHandlers.set(key, handler);
  return () => shutdownHandlers.delete(key);
}

/**
 * Executes all registered shutdown hooks and then closes the active runtime.
 */
export async function shutdown(): Promise<void> {
  for (const handler of shutdownHandlers.values()) {
    try {
      await handler();
    } catch (error) {
      console.error('Error during shutdown handler execution:', error);
    }
  }

  if (activeCoreRuntime) {
    const runtime = activeCoreRuntime;
    activeCoreRuntime = null;
    await runtime.shutdown();
  }

  clearActiveTracer();
}
