import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentInstanceManager, Span, StartSpanOptions, Tracer } from '@prefactor/core';
import { getLogger, SpanContext } from '@prefactor/core';
import { createInstrumentationHooks, finalizeAgentSpan, mergeHooks } from './hooks.js';
import type {
  ClaudeAgentInfo,
  ClaudeMiddleware,
  ClaudeMiddlewareConfig,
  ClaudeQuery,
  ClaudeRuntimeController,
  TracedQueryState,
} from './types.js';

const logger = getLogger('claude');

type ClaudeSystemInitMessage = {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
};

type ClaudeAssistantMessage = {
  type: 'assistant';
  event?: unknown;
  message?: {
    content?: unknown;
  };
};

type ClaudeResultUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type ClaudeResultMessage = {
  type: 'result';
  usage?: ClaudeResultUsage;
  result?: unknown;
  subtype?: string;
  stop_reason?: unknown;
  num_turns?: unknown;
  total_cost_usd?: unknown;
  is_error?: boolean;
};

function startSpanWithParent(
  tracer: Tracer,
  parentSpan: Span | null,
  options: StartSpanOptions
): Span {
  return parentSpan
    ? SpanContext.run(parentSpan, () => tracer.startSpan(options))
    : tracer.startSpan(options);
}

export function createTracedQuery(
  queryFn: ClaudeQuery,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  agentInfo: ClaudeAgentInfo | undefined,
  runtimeController: ClaudeRuntimeController,
  middlewareConfig?: ClaudeMiddlewareConfig,
  toolSpanTypes?: Record<string, string>
): ClaudeMiddleware {
  function tracedQuery(...args: Parameters<ClaudeQuery>): Query {
    const runToken = runtimeController.claimRun();
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

    try {
      const stream = queryFn({ prompt, options: mergedOptions });
      const cleanupRun = createRunCleanup(tracer, agentManager, runtimeController, runToken, state);
      const generator = tapStream(
        stream,
        tracer,
        agentManager,
        agentInfo,
        runtimeController,
        runToken,
        state,
        cleanupRun,
        middlewareConfig
      );

      return decorateQueryStream(stream, generator, cleanupRun);
    } catch (error) {
      runtimeController.releaseRun(runToken);
      throw error;
    }
  }

  return { tracedQuery: tracedQuery as ClaudeMiddleware['tracedQuery'] };
}

export function createClaudeRuntimeController(): ClaudeRuntimeController {
  let activeRun: { token: symbol; agentInstanceStarted: boolean } | null = null;

  return {
    claimRun(): symbol {
      if (activeRun) {
        throw new Error(
          'Prefactor Claude only supports one active tracedQuery() per middleware instance.'
        );
      }

      const token = Symbol('prefactor-claude-run');
      activeRun = { token, agentInstanceStarted: false };
      return token;
    },

    startAgentInstance(
      token: symbol,
      agentManager: AgentInstanceManager,
      agentInfo?: ClaudeAgentInfo
    ): void {
      if (!activeRun || activeRun.token !== token || activeRun.agentInstanceStarted) {
        return;
      }

      agentManager.startInstance(agentInfo);
      activeRun.agentInstanceStarted = true;
    },

    finishAgentInstance(token: symbol, agentManager: AgentInstanceManager): void {
      if (!activeRun || activeRun.token !== token || !activeRun.agentInstanceStarted) {
        return;
      }

      agentManager.finishInstance();
      activeRun.agentInstanceStarted = false;
    },

    releaseRun(token: symbol): void {
      if (activeRun?.token === token) {
        activeRun = null;
      }
    },

    shutdown(agentManager?: AgentInstanceManager | null): void {
      if (activeRun?.agentInstanceStarted && agentManager) {
        agentManager.finishInstance();
      }

      activeRun = null;
    },
  };
}

function decorateQueryStream(
  stream: Query,
  generator: AsyncGenerator<SDKMessage, void>,
  cleanupRun: () => void
): Query {
  return {
    [Symbol.asyncIterator]: () => generator,
    next: generator.next.bind(generator),
    return: async (value?: undefined) => {
      try {
        return await generator.return(value);
      } finally {
        cleanupRun();
      }
    },
    throw: async (error?: unknown) => {
      try {
        return await generator.throw(error);
      } finally {
        cleanupRun();
      }
    },
    interrupt: stream.interrupt.bind(stream),
    setPermissionMode: stream.setPermissionMode.bind(stream),
    setModel: stream.setModel.bind(stream),
    setMaxThinkingTokens: stream.setMaxThinkingTokens.bind(stream),
    applyFlagSettings: stream.applyFlagSettings.bind(stream),
    initializationResult: stream.initializationResult.bind(stream),
    supportedCommands: stream.supportedCommands.bind(stream),
    supportedModels: stream.supportedModels.bind(stream),
    supportedAgents: stream.supportedAgents.bind(stream),
    mcpServerStatus: stream.mcpServerStatus.bind(stream),
    accountInfo: stream.accountInfo.bind(stream),
    rewindFiles: stream.rewindFiles.bind(stream),
    reconnectMcpServer: stream.reconnectMcpServer.bind(stream),
    toggleMcpServer: stream.toggleMcpServer.bind(stream),
    setMcpServers: stream.setMcpServers.bind(stream),
    streamInput: stream.streamInput.bind(stream),
    stopTask: stream.stopTask.bind(stream),
    close: stream.close.bind(stream),
  };
}

async function* tapStream(
  stream: Query,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  agentInfo: ClaudeAgentInfo | undefined,
  runtimeController: ClaudeRuntimeController,
  runToken: symbol,
  state: TracedQueryState,
  cleanupRun: () => void,
  config?: ClaudeMiddlewareConfig
): AsyncGenerator<SDKMessage, void> {
  try {
    for await (const message of stream) {
      try {
        handleMessage(
          message,
          tracer,
          agentManager,
          agentInfo,
          runtimeController,
          runToken,
          state,
          config
        );
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

    cleanupRun();
  }
}

function handleMessage(
  message: SDKMessage,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  agentInfo: ClaudeAgentInfo | undefined,
  runtimeController: ClaudeRuntimeController,
  runToken: symbol,
  state: TracedQueryState,
  config?: ClaudeMiddlewareConfig
): void {
  const messageInfo = message as { type?: string; subtype?: string; event?: unknown };

  if (messageInfo.type === 'system' && messageInfo.subtype === 'init') {
    handleSystemInit(
      message as ClaudeSystemInitMessage,
      tracer,
      agentManager,
      agentInfo,
      runtimeController,
      runToken,
      state
    );
    return;
  }

  if (messageInfo.type === 'assistant' && messageInfo.event === undefined) {
    handleAssistantMessage(message as ClaudeAssistantMessage, tracer, state, config);
    return;
  }

  if (messageInfo.type === 'result') {
    handleResultMessage(
      message as ClaudeResultMessage,
      tracer,
      agentManager,
      runtimeController,
      runToken,
      state
    );
    return;
  }
}

function handleSystemInit(
  msg: ClaudeSystemInitMessage,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  agentInfo: ClaudeAgentInfo | undefined,
  runtimeController: ClaudeRuntimeController,
  runToken: symbol,
  state: TracedQueryState
): void {
  runtimeController.startAgentInstance(runToken, agentManager, agentInfo);

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
  msg: ClaudeAssistantMessage,
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

  state.currentLlmSpan = startSpanWithParent(tracer, state.agentSpan, {
    name: 'claude:llm-turn',
    spanType: 'claude:llm',
    inputs: {},
  });
}

function handleResultMessage(
  msg: ClaudeResultMessage,
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  runtimeController: ClaudeRuntimeController,
  runToken: symbol,
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

  runtimeController.finishAgentInstance(runToken, agentManager);
}

function createRunCleanup(
  tracer: Tracer,
  agentManager: AgentInstanceManager,
  runtimeController: ClaudeRuntimeController,
  runToken: symbol,
  state: TracedQueryState
): () => void {
  let cleanedUp = false;

  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    try {
      finalizeAgentSpan(state, tracer, {
        'claude.finishReason': 'interrupted',
      });
    } catch (error) {
      logger.warn('Error finalizing agent span during cleanup', error);
    }

    runtimeController.finishAgentInstance(runToken, agentManager);
    runtimeController.releaseRun(runToken);
  };
}
