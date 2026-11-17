import { type AlertSeverity, getLogger } from '@prefactor/core';
import type { PrefactorSession, SpanHandle } from './prefactor-session.js';
import type { SessionTracer } from './session-tracer.js';

const logger = getLogger('pi');

/** A span started with {@link PrefactorRecorder.startSpan}. */
export interface PrefactorSpan {
  /** Finishes the span as complete. Later calls to `complete` or `fail` have no effect. */
  complete(result?: Record<string, unknown>): void;
  /** Finishes the span as failed. Later calls to `complete` or `fail` have no effect. */
  fail(result?: Record<string, unknown>): void;
}

/** Options for {@link PrefactorRecorder.startSpan}. */
export interface StartPrefactorSpanOptions {
  /** One of the span types given in the extension's `spanTypeSchemas` option. */
  schemaName: string;
  payload?: Record<string, unknown>;
  /**
   * The span to nest under: another span from this recorder, or the span of a running tool call
   * given by its id. Without one, or when that tool call is not running, the span nests under
   * the open assistant turn, else under the session span.
   */
  parent?: PrefactorSpan | { toolCallId: string };
}

/**
 * Adds to what the extension records for one pi session. Calls never throw and never wait for
 * the network; failures are logged. After the session shuts down, calls record nothing.
 */
export interface PrefactorRecorder {
  /** Starts a span in the session's span tree. */
  startSpan(options: StartPrefactorSpanOptions): PrefactorSpan;
  /**
   * Records a quality payload on the session's agent instance for a schema in the extension's
   * `qualitySchemas` option. A null payload removes the recorded value for that name.
   */
  recordQuality(name: string, payload: Record<string, unknown> | null): void;
  /** Raises an alert on the session's agent instance, for a schema in `alertSchemas`. */
  raiseAlert(name: string, severity: AlertSeverity, payload: Record<string, unknown>): void;
}

/**
 * Creates the recorder for one session, and a function that stops it when the session shuts
 * down.
 */
export function createRecorder(
  session: PrefactorSession,
  tracer: SessionTracer
): { recorder: PrefactorRecorder; stop: () => void } {
  let stopped = false;
  const handles = new WeakMap<PrefactorSpan, SpanHandle>();

  const run = (name: string, action: () => void): void => {
    if (stopped) {
      logger.warn(`Prefactor ${name} called after the pi session shut down; nothing recorded`);
      return;
    }
    try {
      action();
    } catch (error) {
      logger.warn(`Prefactor ${name} failed`, error);
    }
  };

  const recorder: PrefactorRecorder = {
    startSpan(options) {
      let handle: SpanHandle | undefined;
      run('startSpan', () => {
        const parent = options.parent;
        handle = tracer.startCustomSpan({
          schemaName: options.schemaName,
          payload: options.payload ?? {},
          ...(parent && 'toolCallId' in parent
            ? { toolCallId: parent.toolCallId }
            : { parent: parent ? handles.get(parent) : undefined }),
        });
      });
      const finish = (status: 'complete' | 'failed', result: Record<string, unknown> = {}) =>
        run(status === 'complete' ? 'complete' : 'fail', () => {
          if (handle) {
            tracer.finishCustomSpan(handle, status, result);
          }
        });
      const span: PrefactorSpan = {
        complete: (result) => finish('complete', result),
        fail: (result) => finish('failed', result),
      };
      if (handle) {
        handles.set(span, handle);
      }
      return span;
    },
    recordQuality(name, payload) {
      run('recordQuality', () => session.recordQuality(name, payload));
    },
    raiseAlert(name, severity, payload) {
      run('raiseAlert', () => session.raiseAlert(name, severity, payload));
    },
  };

  return {
    recorder,
    stop: () => {
      stopped = true;
    },
  };
}
