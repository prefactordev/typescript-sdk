import type { Config, Span, Tracer } from '@prefactor/core';
import { getLogger, SpanContext, SpanType, serializeValue } from '@prefactor/core';

type HookContext = { sessionKey?: string; runId?: string; agentId?: string; toolName?: string };

const toKey = (ctx: HookContext): string => ctx.sessionKey ?? ctx.runId ?? ctx.agentId ?? 'unknown';

const sanitize = (value: unknown, maxLength: number): unknown => serializeValue(value, maxLength);

export function createInstrumentation(tracer: Tracer, config: Config) {
  const logger = getLogger('openclaw');
  const agentSpans = new Map<string, Span>();

  const logHook = (
    hook: string,
    spanType: SpanType,
    event: Record<string, unknown>,
    ctx: HookContext
  ) => {
    console.log(`OpenClaw hook: ${hook}`, {
      spanType,
      ctx,
      event: sanitize(event, config.maxInputLength),
    });
  };

  const endToolSpan = (span: Span, reason: string, hook: string, toolName?: string) => {
    const outputs = config.captureOutputs
      ? {
          reason,
          hook,
          toolName,
        }
      : undefined;
    tracer.endSpan(span, { outputs });
  };

  const flushToolQueue = (key: string, reason: string, hook: string) => {
    const queue = toolQueues.get(key);
    if (!queue?.length) return;
    while (queue.length > 0) {
      const span = queue.shift();
      if (span) {
        endToolSpan(span, reason, hook, span.name);
      }
    }
    toolQueues.delete(key);
  };

  const flushToolQueuesForSession = (ctx: HookContext, reason: string, hook: string) => {
    const prefix = `${toKey(ctx)}:`;
    for (const [key] of toolQueues) {
      if (key.startsWith(prefix)) {
        flushToolQueue(key, reason, hook);
      }
    }
  };

  const beforeAgentStart = (event: Record<string, unknown>, ctx: HookContext) => {
    logHook('before_agent_start', SpanType.AGENT, event, ctx);
    flushToolQueuesForSession(ctx, 'implicit_tool_close:next_agent', 'before_agent_start');
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
    logHook('agent_end', SpanType.AGENT, event, ctx);
    const key = toKey(ctx);
    const span = agentSpans.get(key);
    if (!span) return;
    const outputs = config.captureOutputs
      ? (sanitize(event, config.maxOutputLength) as Record<string, unknown>)
      : undefined;
    tracer.endSpan(span, { outputs });
    agentSpans.delete(key);
    flushToolQueuesForSession(ctx, 'implicit_tool_close:agent_end', 'agent_end');
  };

  const toolQueues = new Map<string, Span[]>();

  const beforeToolCall = (event: Record<string, unknown>, ctx: HookContext) => {
    logHook('before_tool_call', SpanType.TOOL, event, ctx);
    const toolName = String(event.toolName ?? ctx.toolName ?? 'unknown');
    const key = `${toKey(ctx)}:${toolName}`;
    flushToolQueue(key, 'implicit_tool_close:next_tool_call', 'before_tool_call');
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
    logHook('after_tool_call', SpanType.TOOL, event, ctx);
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

  const messageReceived = (event: Record<string, unknown>, _ctx: HookContext) => {
    logHook('message_received', SpanType.CHAIN, event, _ctx);
    const inputs = config.captureInputs
      ? (sanitize({ direction: 'inbound', ...event }, config.maxInputLength) as Record<
          string,
          unknown
        >)
      : {};
    const span = tracer.startSpan({ name: 'openclaw:message', spanType: SpanType.CHAIN, inputs });
    tracer.endSpan(span, { outputs: config.captureOutputs ? inputs : undefined });
  };

  const messageSent = (event: Record<string, unknown>, _ctx: HookContext) => {
    logHook('message_sent', SpanType.CHAIN, event, _ctx);
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
