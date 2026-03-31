import { describe, expect, spyOn, test } from 'bun:test';
import type {
  PrefactorTransportHealthState,
  PrefactorTransportOperation,
} from '../../src/errors.js';
import { SpanStatus, SpanType, withSpan } from '../../src/index';
import type { Span } from '../../src/tracing/span';
import type { Tracer } from '../../src/tracing/tracer';
import { Tracer as CoreTracer } from '../../src/tracing/tracer';
import type {
  AgentInstanceOptions,
  FinishSpanOptions,
  Transport,
} from '../../src/transport/http.js';

function createSpan(): Span {
  return {
    spanId: 'span-1',
    parentSpanId: null,
    traceId: 'trace-1',
    name: 'test',
    spanType: SpanType.CHAIN,
    startTime: Date.now(),
    endTime: null,
    status: SpanStatus.RUNNING,
    inputs: {},
    outputs: null,
    tokenUsage: null,
    error: null,
    metadata: {},
  };
}

class ThrowingTransport implements Transport {
  emit(_span: Span): void {
    throw new Error('transport unavailable');
  }

  finishSpan(_spanId: string, _endTime: number, _options?: FinishSpanOptions): void {}

  startAgentInstance(_options?: AgentInstanceOptions): void {}

  finishAgentInstance(): void {}

  registerSchema(_schema: Record<string, unknown>): void {}

  assertUsable(_operation: PrefactorTransportOperation): void {}

  getHealthState(): PrefactorTransportHealthState {
    return 'healthy';
  }

  async close(): Promise<void> {}
}

describe('withSpan', () => {
  test('throws when no active tracer is available', async () => {
    await expect(
      withSpan(
        {
          name: 'missing-tracer',
          spanType: 'custom:missing-tracer',
          inputs: {},
        },
        async () => 'never-runs'
      )
    ).rejects.toThrow(/No active tracer found/i);
  });

  test('ends span with returned value in outputs', async () => {
    const span = createSpan();
    const ended: Array<{ span: Span; outputs?: Record<string, unknown> }> = [];

    const tracer = {
      startSpan: () => span,
      endSpan: (endedSpan, options) => {
        ended.push({ span: endedSpan, outputs: options?.outputs });
      },
    } as unknown as Tracer;

    const result = await withSpan(
      tracer,
      {
        name: 'custom',
        spanType: 'custom:normalize-response',
        inputs: {},
      },
      async () => 'normalized text'
    );

    expect(result).toBe('normalized text');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.outputs).toEqual({ result: 'normalized text' });
  });

  test('returns handler result when telemetry submission fails during endSpan', async () => {
    const tracer = new CoreTracer(new ThrowingTransport());
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        withSpan(
          tracer,
          {
            name: 'custom',
            spanType: SpanType.CHAIN,
            inputs: {},
          },
          async () => 'normalized text'
        )
      ).resolves.toBe('normalized text');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('preserves handler error when telemetry submission fails during endSpan', async () => {
    const tracer = new CoreTracer(new ThrowingTransport());
    const userError = new Error('handler failed');
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        withSpan(
          tracer,
          {
            name: 'custom',
            spanType: SpanType.CHAIN,
            inputs: {},
          },
          async () => {
            throw userError;
          }
        )
      ).rejects.toBe(userError);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
