import { SpanContext, SpanType, serializeValue } from '@prefactor/core';
import type { Config, Span, Tracer } from '@prefactor/core';

type HookContext = { sessionKey?: string; runId?: string; agentId?: string; toolName?: string };

const toKey = (ctx: HookContext): string => ctx.sessionKey ?? ctx.runId ?? ctx.agentId ?? 'unknown';

const sanitize = (value: unknown, maxLength: number): unknown => serializeValue(value, maxLength);

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

  const toolQueues = new Map<string, Span[]>();

  const beforeToolCall = (event: Record<string, unknown>, ctx: HookContext) => {
    const toolName = String(event.toolName ?? ctx.toolName ?? 'unknown');
    const key = `${toKey(ctx)}:${toolName}`;
    const inputs = config.captureInputs
      ? (sanitize(event, config.maxInputLength) as Record<string, unknown>)
      : {};
    const parent = agentSpans.get(toKey(ctx));
    const span = parent
      ? SpanContext.run(parent, () =>
          tracer.startSpan({ name: toolName, spanType: SpanType.TOOL, inputs })
        )
      : tracer.startSpan({ name: toolName, spanType: SpanType.TOOL, inputs });

    const queue = toolQueues.get(key) ?? [];
    queue.push(span);
    toolQueues.set(key, queue);
  };

  const afterToolCall = (event: Record<string, unknown>, ctx: HookContext) => {
    const toolName = String(event.toolName ?? ctx.toolName ?? 'unknown');
    const key = `${toKey(ctx)}:${toolName}`;
    const queue = toolQueues.get(key);
    const span = queue?.shift();
    const outputs = config.captureOutputs
      ? (sanitize(event, config.maxOutputLength) as Record<string, unknown>)
      : undefined;

    if (span) {
      tracer.endSpan(span, { outputs });
      return;
    }

    const fallback = tracer.startSpan({ name: toolName, spanType: SpanType.TOOL, inputs: {} });
    tracer.endSpan(fallback, { outputs });
  };

  const messageReceived = (event: Record<string, unknown>, ctx: HookContext) => {
    const inputs = config.captureInputs
      ? (sanitize({ direction: 'inbound', ...event }, config.maxInputLength) as Record<
          string,
          unknown
        >)
      : {};
    const span = tracer.startSpan({ name: 'openclaw:message', spanType: SpanType.CHAIN, inputs });
    tracer.endSpan(span, { outputs: config.captureOutputs ? inputs : undefined });
  };

  const messageSent = (event: Record<string, unknown>, ctx: HookContext) => {
    const inputs = config.captureInputs
      ? (sanitize({ direction: 'outbound', ...event }, config.maxInputLength) as Record<
          string,
          unknown
        >)
      : {};
    const span = tracer.startSpan({ name: 'openclaw:message', spanType: SpanType.CHAIN, inputs });
    tracer.endSpan(span, { outputs: config.captureOutputs ? inputs : undefined });
  };

  return {
    beforeAgentStart,
    agentEnd,
    beforeToolCall,
    afterToolCall,
    messageReceived,
    messageSent,
    agentSpans,
  };
}
