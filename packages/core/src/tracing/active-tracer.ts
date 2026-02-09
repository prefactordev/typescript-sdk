import type { Tracer } from './tracer.js';

let activeTracer: Tracer | undefined;

export function setActiveTracer(tracer: Tracer): void {
  activeTracer = tracer;
}

export function getActiveTracer(): Tracer | undefined {
  return activeTracer;
}

export function clearActiveTracer(tracer?: Tracer): void {
  if (!tracer || activeTracer === tracer) {
    activeTracer = undefined;
  }
}
