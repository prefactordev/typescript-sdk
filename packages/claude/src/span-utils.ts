import { type Span, SpanContext, type StartSpanOptions, type Tracer } from '@prefactor/core';

export function startSpanWithParent(
  tracer: Tracer,
  parentSpan: Span | null,
  options: StartSpanOptions
): Span {
  return parentSpan
    ? SpanContext.run(parentSpan, () => tracer.startSpan(options))
    : tracer.startSpan(options);
}
