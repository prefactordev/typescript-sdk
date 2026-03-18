import type { HookCallback, HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk';
import { getLogger, SpanContext, type Tracer } from '@prefactor/core';
import { resolveToolSpanType } from './schema.js';
import { createToolSpanInputs, createToolSpanOutputs } from './tool-span-contract.js';
import type { ClaudeMiddlewareConfig, TracedQueryState } from './types.js';

const logger = getLogger('claude');

type HooksMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

const POST_EVENTS = new Set<HookEvent>(['PostToolUse', 'PostToolUseFailure']);

export function createInstrumentationHooks(
  tracer: Tracer,
  toolSpanTypes: Record<string, string> | undefined,
  state: TracedQueryState,
  config?: ClaudeMiddlewareConfig
): HooksMap {
  const preToolUse: HookCallback = async (input, toolUseID) => {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hook input payloads are dynamic
      const hookInput = input as any;
      const toolName = hookInput.tool_name as string;
      const toolInput = hookInput.tool_input;

      const spanType = resolveToolSpanType(toolName, toolSpanTypes);
      const inputs =
        config?.captureTools !== false
          ? createToolSpanInputs({
              toolName,
              toolUseId: toolUseID,
              input: toolInput,
            })
          : createToolSpanInputs({ toolName, toolUseId: toolUseID });

      const parentSpan = state.currentLlmSpan ?? state.agentSpan;
      const span = parentSpan
        ? SpanContext.run(parentSpan, () =>
            tracer.startSpan({ name: 'claude:tool-call', spanType, inputs })
          )
        : tracer.startSpan({ name: 'claude:tool-call', spanType, inputs });

      if (toolUseID) {
        state.toolSpanMap.set(toolUseID, span);
      }
    } catch (error) {
      logger.warn('PreToolUse hook error', error);
    }

    return {};
  };

  const postToolUse: HookCallback = async (input, toolUseID) => {
    try {
      if (!toolUseID) return {};
      const span = state.toolSpanMap.get(toolUseID);
      if (!span) {
        logger.warn(`PostToolUse: no span found for toolUseID ${toolUseID}`);
        return {};
      }
      state.toolSpanMap.delete(toolUseID);

      // biome-ignore lint/suspicious/noExplicitAny: hook input payloads are dynamic
      const hookInput = input as any;
      const toolResponse = hookInput.tool_response;

      const outputs = config?.captureTools !== false ? createToolSpanOutputs(toolResponse) : {};
      tracer.endSpan(span, { outputs });
    } catch (error) {
      logger.warn('PostToolUse hook error', error);
    }

    return {};
  };

  const postToolUseFailure: HookCallback = async (_input, toolUseID) => {
    try {
      if (!toolUseID) return {};
      const span = state.toolSpanMap.get(toolUseID);
      if (!span) return {};
      state.toolSpanMap.delete(toolUseID);

      tracer.endSpan(span, { error: new Error('Tool execution failed') });
    } catch (error) {
      logger.warn('PostToolUseFailure hook error', error);
    }

    return {};
  };

  const subagentStart: HookCallback = async (input) => {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hook input payloads are dynamic
      const hookInput = input as any;
      const agentId = hookInput.agent_id as string;
      const agentType = hookInput.agent_type as string | undefined;

      const parentSpan = state.currentLlmSpan ?? state.agentSpan;
      const span = parentSpan
        ? SpanContext.run(parentSpan, () =>
            tracer.startSpan({
              name: 'claude:subagent',
              spanType: 'claude:subagent',
              inputs: { agent_id: agentId, agent_type: agentType },
            })
          )
        : tracer.startSpan({
            name: 'claude:subagent',
            spanType: 'claude:subagent',
            inputs: { agent_id: agentId, agent_type: agentType },
          });

      state.subagentSpanMap.set(agentId, span);
    } catch (error) {
      logger.warn('SubagentStart hook error', error);
    }

    return {};
  };

  const subagentStop: HookCallback = async (input) => {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: hook input payloads are dynamic
      const hookInput = input as any;
      const agentId = hookInput.agent_id as string;
      const span = state.subagentSpanMap.get(agentId);
      if (!span) {
        logger.warn(`SubagentStop: no span found for agent_id ${agentId}`);
        return {};
      }
      state.subagentSpanMap.delete(agentId);

      tracer.endSpan(span, {
        outputs: {
          agent_type: hookInput.agent_type,
          transcript_path: hookInput.agent_transcript_path,
        },
      });
    } catch (error) {
      logger.warn('SubagentStop hook error', error);
    }

    return {};
  };

  const stop: HookCallback = async () => {
    try {
      finalizeAgentSpan(state, tracer);
    } catch (error) {
      logger.warn('Stop hook error', error);
    }

    return {};
  };

  return {
    PreToolUse: [{ hooks: [preToolUse] }],
    PostToolUse: [{ hooks: [postToolUse] }],
    PostToolUseFailure: [{ hooks: [postToolUseFailure] }],
    SubagentStart: [{ hooks: [subagentStart] }],
    SubagentStop: [{ hooks: [subagentStop] }],
    Stop: [{ hooks: [stop] }],
  };
}

export function mergeHooks(instrumentationHooks: HooksMap, userHooks?: HooksMap): HooksMap {
  if (!userHooks) return instrumentationHooks;

  const allEvents = new Set<HookEvent>([
    ...(Object.keys(instrumentationHooks) as HookEvent[]),
    ...(Object.keys(userHooks) as HookEvent[]),
  ]);

  const merged: HooksMap = {};

  for (const event of allEvents) {
    const ours = instrumentationHooks[event] ?? [];
    const theirs = userHooks[event] ?? [];

    if (POST_EVENTS.has(event)) {
      merged[event] = [...theirs, ...ours];
    } else {
      merged[event] = [...ours, ...theirs];
    }
  }

  return merged;
}

export function finalizeAgentSpan(
  state: TracedQueryState,
  tracer: Tracer,
  outputs?: Record<string, unknown>,
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number },
  error?: Error
): void {
  if (state.agentSpanFinished || !state.agentSpan) return;
  state.agentSpanFinished = true;
  tracer.endSpan(state.agentSpan, { outputs, tokenUsage, error });
}
