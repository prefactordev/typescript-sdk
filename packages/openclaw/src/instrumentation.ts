import { SpanType, serializeValue } from '@prefactor/core';
import type { Config, Span, Tracer } from '@prefactor/core';

type HookContext = { sessionKey?: string; runId?: string; agentId?: string };

const toKey = (ctx: HookContext): string =>
  ctx.sessionKey ?? ctx.runId ?? ctx.agentId ?? 'unknown';

const sanitize = (value: unknown, maxLength: number): unknown =>
  serializeValue(value, maxLength);

export function createInstrumentation(tracer: Tracer, config: Config) {
  const agentSpans = new Map<string, Span>();

  const beforeAgentStart = (event: Record<string, unknown>, ctx: HookContext) => {
    const key = toKey(ctx);
    const inputs = config.captureInputs
      ? (sanitize(event, config.maxInputLength) as Record<string, unknown>)
      : {};

    const span = tracer.startSpan({
      name: `openclaw:${ctx.agentId ?? 'agent'}`,
      spanType: SpanType.AGENT,
      inputs,
    });
    agentSpans.set(key, span);
  };

  const agentEnd = (event: Record<string, unknown>, ctx: HookContext) => {
    const key = toKey(ctx);
    const span = agentSpans.get(key);
    if (!span) return;
    const outputs = config.captureOutputs
      ? (sanitize(event, config.maxOutputLength) as Record<string, unknown>)
      : undefined;
    tracer.endSpan(span, { outputs });
    agentSpans.delete(key);
  };

  return { beforeAgentStart, agentEnd, agentSpans };
}
