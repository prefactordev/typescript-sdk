import type { CoreRuntime } from './create-core.js';
import { clearActiveTracer } from './tracing/active-tracer.js';

const shutdownHandlers = new Map<string, () => void | Promise<void>>();
let activeCoreRuntime: CoreRuntime | null = null;

export function setActiveCoreRuntime(runtime: CoreRuntime | null): void {
  activeCoreRuntime = runtime;
}

export function registerShutdownHandler(
  key: string,
  handler: () => void | Promise<void>
): () => void {
  shutdownHandlers.set(key, handler);
  return () => shutdownHandlers.delete(key);
}

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
