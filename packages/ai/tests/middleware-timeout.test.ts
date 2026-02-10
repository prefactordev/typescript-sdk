import { describe, expect, test } from 'bun:test';
import type { AgentInstanceManager, Span, Tracer } from '@prefactor/core';
import { createPrefactorMiddleware } from '../src/middleware.js';

function createSpan(spanId: string, spanType: string): Span {
  return {
    spanId,
    parentSpanId: null,
    traceId: `trace-${spanId}`,
    name: spanId,
    spanType,
    startTime: Date.now(),
    endTime: null,
    status: 'running',
    inputs: {},
    outputs: null,
    tokenUsage: null,
    error: null,
    metadata: {},
  };
}

describe('middleware timeout handling', () => {
  test('fails request and marks agent span failed when generate hangs', async () => {
    const ended: Array<{ span: Span; options?: unknown }> = [];
    const startedSpanTypes: string[] = [];
    const tracer: Tracer = {
      startSpan: (options) => {
        startedSpanTypes.push(options.spanType);
        return createSpan(`span-${options.spanType}-${Math.random()}`, options.spanType);
      },
      endSpan: (span, options) => {
        ended.push({ span, options });
      },
      close: async () => {},
      startAgentInstance: () => {},
      finishAgentInstance: () => {},
    } as unknown as Tracer;

    const lifecycle = { started: false };
    let finished = false;
    const agentManager = {
      startInstance: () => {
        lifecycle.started = true;
      },
      finishInstance: () => {
        finished = true;
      },
    } as unknown as AgentInstanceManager;

    const middleware = createPrefactorMiddleware(tracer, undefined, {
      agentManager,
      agentLifecycle: lifecycle,
      deadTimeoutMs: 10,
    });

    const run = middleware.wrapGenerate?.({
      doGenerate: async () => await new Promise(() => {}),
      params: {},
      model: { provider: 'test', modelId: 'hang' },
    });

    const result = await Promise.race([
      run?.then(
        () => 'resolved',
        () => 'rejected'
      ),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ]);

    expect(result).toBe('rejected');
    expect(finished).toBe(true);
    expect(ended).toHaveLength(2);
    expect(startedSpanTypes).toContain('ai:agent');
    expect(startedSpanTypes).toContain('ai:llm');
  });
});
