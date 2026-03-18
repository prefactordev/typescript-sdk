import { type Query, query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  type AgentInstanceManager,
  type Config,
  getLogger,
  SpanContext,
  type Tracer,
} from '@prefactor/core';
import { createInstrumentationHooks, finalizeAgentSpan, mergeHooks } from './hooks.js';
import type { ClaudeMiddleware, ClaudeMiddlewareConfig, TracedQueryState } from './types.js';

const logger = getLogger('claude');

export function createTracedQuery(
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  config: Config,
  middlewareConfig?: ClaudeMiddlewareConfig,
  toolSpanTypes?: Record<string, string>,
  agentLifecycle?: { started: boolean }
): ClaudeMiddleware {
  const httpConfig = config.httpConfig;
  const agentInfo = httpConfig
    ? {
        agentId: httpConfig.agentId,
        agentIdentifier: httpConfig.agentIdentifier,
        agentName: httpConfig.agentName,
        agentDescription: httpConfig.agentDescription,
      }
    : undefined;

  function tracedQuery(...args: Parameters<typeof query>): Query {
    const [params] = args;
    const { prompt, options } = params;

    const state: TracedQueryState = {
      currentLlmSpan: null,
      currentLlmOutputs: {},
      agentSpan: null,
      agentSpanFinished: false,
      toolSpanMap: new Map(),
      subagentSpanMap: new Map(),
    };

    const instrumentationHooks = createInstrumentationHooks(
      tracer,
      toolSpanTypes,
      state,
      middlewareConfig
    );

    const mergedOptions = {
      ...options,
      hooks: mergeHooks(instrumentationHooks, options?.hooks),
    };

    const stream = query({ prompt, options: mergedOptions });

    return wrapQuery(
      stream,
      tracer,
      agentManager,
      agentInfo,
      agentLifecycle,
      state,
      middlewareConfig
    );
  }

  return { tracedQuery: tracedQuery as ClaudeMiddleware['tracedQuery'] };
}

function wrapQuery(
  stream: Query,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  agentInfo: Parameters<AgentInstanceManager['startInstance']>[0] | undefined,
  agentLifecycle: { started: boolean } | undefined,
  state: TracedQueryState,
  config?: ClaudeMiddlewareConfig
): Query {
  const generator = tapStream(
    stream,
    tracer,
    agentManager,
    agentInfo,
    agentLifecycle,
    state,
    config
  );

  // Use a Proxy to forward all property accesses to the underlying stream,
  // except for the async iterator protocol which comes from our tapStream generator.
  return new Proxy(stream, {
    get(target, prop, receiver) {
      // Async iterator protocol comes from our instrumented generator
      if (prop === Symbol.asyncIterator) {
        return () => generator;
      }
      // next/return/throw come from our generator to drive iteration
      if (prop === 'next' || prop === 'return' || prop === 'throw') {
        const genMethod = generator[prop as keyof AsyncGenerator];
        return typeof genMethod === 'function' ? genMethod.bind(generator) : genMethod;
      }
      // Everything else (interrupt, close, setModel, accountInfo, etc.)
      // delegates to the underlying stream
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function* tapStream(
  stream: Query,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  agentInfo: Parameters<AgentInstanceManager['startInstance']>[0] | undefined,
  agentLifecycle: { started: boolean } | undefined,
  state: TracedQueryState,
  config?: ClaudeMiddlewareConfig
): AsyncGenerator<SDKMessage, void> {
  try {
    for await (const message of stream) {
      try {
        handleMessage(message, tracer, agentManager, agentInfo, agentLifecycle, state, config);
      } catch (error) {
        logger.warn('Error processing message for tracing', error);
      }

      yield message;
    }
  } finally {
    // End any open LLM span
    if (state.currentLlmSpan) {
      try {
        tracer.endSpan(state.currentLlmSpan, {
          outputs: { ...state.currentLlmOutputs, 'claude.finishReason': 'interrupted' },
        });
      } catch (error) {
        logger.warn('Error ending LLM span in finally', error);
      }
      state.currentLlmSpan = null;
      state.currentLlmOutputs = {};
    }

    // End any remaining tool spans
    for (const [_id, span] of state.toolSpanMap) {
      try {
        tracer.endSpan(span, { error: new Error('Stream interrupted') });
      } catch (error) {
        logger.warn('Error ending tool span in finally', error);
      }
    }
    state.toolSpanMap.clear();

    // End any remaining subagent spans
    for (const [_id, span] of state.subagentSpanMap) {
      try {
        tracer.endSpan(span, { error: new Error('Stream interrupted') });
      } catch (error) {
        logger.warn('Error ending subagent span in finally', error);
      }
    }
    state.subagentSpanMap.clear();

    // Finalize agent span if not already done
    try {
      finalizeAgentSpan(state, tracer, {
        'claude.finishReason': 'interrupted',
      });
    } catch (error) {
      logger.warn('Error finalizing agent span in finally', error);
    }
  }
}

function handleMessage(
  message: SDKMessage,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  agentInfo: Parameters<AgentInstanceManager['startInstance']>[0] | undefined,
  agentLifecycle: { started: boolean } | undefined,
  state: TracedQueryState,
  config?: ClaudeMiddlewareConfig
): void {
  // biome-ignore lint/suspicious/noExplicitAny: SDK message types are a wide union
  const msg = message as any;

  if (msg.type === 'system' && msg.subtype === 'init') {
    handleSystemInit(msg, tracer, agentManager, agentInfo, agentLifecycle, state);
    return;
  }

  if (msg.type === 'assistant' && !('event' in msg)) {
    handleAssistantMessage(msg, tracer, state, config);
    return;
  }

  if (msg.type === 'result') {
    handleResultMessage(msg, tracer, agentManager, agentLifecycle, state);
    return;
  }
}

function handleSystemInit(
  // biome-ignore lint/suspicious/noExplicitAny: SDK message types are dynamic
  msg: any,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  agentInfo: Parameters<AgentInstanceManager['startInstance']>[0] | undefined,
  agentLifecycle: { started: boolean } | undefined,
  state: TracedQueryState
): void {
  if (agentLifecycle && !agentLifecycle.started) {
    agentManager.startInstance(agentInfo);
    agentLifecycle.started = true;
  }

  state.agentSpan = tracer.startSpan({
    name: 'claude:session',
    spanType: 'claude:agent',
    inputs: {
      session_id: msg.session_id,
      model: msg.model,
    },
  });
}

function handleAssistantMessage(
  // biome-ignore lint/suspicious/noExplicitAny: SDK message types are dynamic
  msg: any,
  tracer: Tracer,
  state: TracedQueryState,
  config?: ClaudeMiddlewareConfig
): void {
  // End previous LLM span if exists, passing stored outputs
  if (state.currentLlmSpan) {
    tracer.endSpan(state.currentLlmSpan, { outputs: state.currentLlmOutputs });
    state.currentLlmSpan = null;
    state.currentLlmOutputs = {};
  }

  // Build outputs for this new LLM turn
  const outputs: Record<string, unknown> = {};
  if (config?.captureContent !== false && msg.message?.content) {
    outputs['claude.response.content'] = msg.message.content;
  }
  state.currentLlmOutputs = outputs;

  const parentSpan = state.agentSpan;
  state.currentLlmSpan = parentSpan
    ? SpanContext.run(parentSpan, () =>
        tracer.startSpan({
          name: 'claude:llm-turn',
          spanType: 'claude:llm',
          inputs: {},
        })
      )
    : tracer.startSpan({
        name: 'claude:llm-turn',
        spanType: 'claude:llm',
        inputs: {},
      });
}

function handleResultMessage(
  // biome-ignore lint/suspicious/noExplicitAny: SDK message types are dynamic
  msg: any,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  agentLifecycle: { started: boolean } | undefined,
  state: TracedQueryState
): void {
  // End final LLM span with stored outputs
  if (state.currentLlmSpan) {
    tracer.endSpan(state.currentLlmSpan, { outputs: state.currentLlmOutputs });
    state.currentLlmSpan = null;
    state.currentLlmOutputs = {};
  }

  // Extract usage
  const usage = msg.usage;
  const tokenUsage =
    usage?.input_tokens !== undefined || usage?.output_tokens !== undefined
      ? {
          promptTokens: (usage.input_tokens as number) ?? 0,
          completionTokens: (usage.output_tokens as number) ?? 0,
          totalTokens:
            ((usage.input_tokens as number) ?? 0) + ((usage.output_tokens as number) ?? 0),
        }
      : undefined;

  // Finalize agent span — mark as error if the result is an error
  const agentError = msg.is_error ? new Error(msg.subtype ?? 'Agent error') : undefined;
  finalizeAgentSpan(
    state,
    tracer,
    {
      result: msg.result,
      subtype: msg.subtype,
      stop_reason: msg.stop_reason,
      num_turns: msg.num_turns,
      total_cost_usd: msg.total_cost_usd,
      is_error: msg.is_error,
    },
    tokenUsage,
    agentError
  );

  // Finish agent instance
  if (agentLifecycle?.started) {
    agentManager.finishInstance();
    agentLifecycle.started = false;
  }
}

/** @internal Exported for testing only */
export const wrapQueryForTest = wrapQuery;

/** @internal Exported for testing only */
export const handleMessageForTest = handleMessage;
