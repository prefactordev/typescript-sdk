/**
 * OpenClaw plugin for Prefactor observability. Provides automatic tracing of agent
 * lifecycle events including sessions, user interactions, agent runs, and tool calls.
 *
 * ## `@prefactor/openclaw` overview
 *
 * This plugin hooks into OpenClaw's lifecycle events to create a hierarchical span
 * structure for distributed tracing. The span hierarchy follows:
 *
 * ```
 * session (24hr lifetime, root span)
 *   └─ user_interaction (5min idle timeout)
 *       ├─ user_message (instant, auto-closed)
 *       ├─ agent_run (child of interaction)
 *       │   ├─ tool_call (concurrent, children of agent_run)
 *       │   └─ tool_call
 *       └─ assistant_response (instant, auto-closed)
 * ```
 *
 * ## Hook handlers
 *
 * The plugin registers 14 hooks that automatically create and manage spans:
 *
 * - **Gateway**: `gateway_start`, `gateway_stop`
 * - **Session**: `session_start`, `session_end`
 * - **Agent**: `before_agent_start`, `agent_end`
 * - **Compaction**: `before_compaction`, `after_compaction`
 * - **Tool**: `before_tool_call`, `after_tool_call`, `tool_result_persist`
 * - **Message**: `message_received`, `message_sending`, `message_sent`
 *
 * ## Span types
 *
 * - `openclaw:session` - Root span for the OpenClaw session (24hr lifetime)
 * - `openclaw:user_interaction` - User interaction context (5min idle timeout)
 * - `openclaw:user_message` - Inbound user message event
 * - `openclaw:agent_run` - Agent execution run
 * - `openclaw:tool_call` - Tool execution (supports concurrent calls)
 * - `openclaw:assistant_response` - Assistant response event
 *
 * ## Exports
 *
 * - {@link Agent} - HTTP client for Prefactor API (span CRUD, instance lifecycle)
 * - {@link SessionStateManager} - Manages span hierarchy and timeouts per session
 * - {@link Logger} - Structured logger for plugin diagnostics
 * - {@link register} - Plugin entry point (used by OpenClaw, not imported directly)
 *
 * @module @prefactor/openclaw
 * @category Packages
 * @packageDocumentation
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { type Agent, type AgentConfig, createAgent } from './agent.js';
import { createLogger } from './logger.js';
import { createSessionStateManager } from './session-state.js';

const prefactorConfigSchema = z
  .object({
    apiUrl: z.string().optional(),
    apiToken: z.string().optional(),
    agentId: z.string().optional(),
    agentVersion: z.string().optional().default('default'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
    userInteractionTimeoutMinutes: z.number().int().positive().optional().default(5),
    sessionTimeoutHours: z.number().int().positive().optional().default(24),
  })
  .strict();

const defaultConfig = {
  apiUrl: process.env.PREFACTOR_API_URL,
  apiToken: process.env.PREFACTOR_API_TOKEN,
  agentId: process.env.PREFACTOR_AGENT_ID,
};

export default function register(api: OpenClawPluginApi) {
  const config = prefactorConfigSchema.parse(api.pluginConfig || defaultConfig);

  const logLevel = config.logLevel;
  const logger = createLogger(logLevel);

  let agent: Agent | null = null;
  let agentInitialized = false;

  if (config.apiUrl && config.apiToken && config.agentId) {
    try {
      const agentConfig: AgentConfig = {
        apiUrl: config.apiUrl,
        apiToken: config.apiToken,
        agentId: config.agentId,
        openclawVersion: api.version || 'unknown',
        pluginVersion: packageJson.version,
        userAgentVersion: config.agentVersion,
        maxRetries: 3,
        initialRetryDelay: 1000,
        requestTimeout: 30000,
      };

      agent = createAgent(agentConfig, logger);
      agentInitialized = true;

      logger.info('prefactor_agent_initialized', {
        agentId: config.agentId,
        apiUrl: config.apiUrl,
        agentVersion: config.agentVersion,
      });
    } catch (err) {
      logger.error('prefactor_agent_init_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.warn('prefactor_agent_not_configured', {
      missing: [
        !config.apiUrl && 'apiUrl',
        !config.apiToken && 'apiToken',
        !config.agentId && 'agentId',
      ].filter(Boolean),
    });
  }

  logger.info('plugin_init_prefactor', {
    logLevel,
    agentInitialized,
    version: packageJson.version,
  });

  const sessionManager = createSessionStateManager(agent, logger, {
    userInteractionTimeoutMs: config.userInteractionTimeoutMinutes * 60 * 1000,
    sessionTimeoutMs: config.sessionTimeoutHours * 60 * 60 * 1000,
  });

  let pendingUserMessage: { from: string; content: string; channelId: string } | null = null;

  // ==================== GATEWAY LIFECYCLE ====================

  api.on('gateway_start', (event, _ctx) => {
    const timestamp = Date.now();
    logger.info('gateway_start', {
      timestamp,
      port: event.port,
      pid: process.pid,
      agentInitialized,
    });
  });

  api.on('gateway_stop', (event, _ctx) => {
    const timestamp = Date.now();
    logger.info('gateway_stop', { timestamp, reason: event.reason });

    if (agent) {
      agent.emergencyCleanup().catch((err) => {
        logger.error('prefactor_emergency_cleanup_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    sessionManager.cleanupAllSessions().catch((err) => {
      logger.error('prefactor_sessions_cleanup_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  // ==================== SESSION LIFECYCLE ====================

  api.on('session_start', (event, ctx) => {
    const sessionKey = ctx.sessionId;
    const timestamp = Date.now();

    logger.info('session_start', { sessionKey, timestamp, resumedFrom: event.resumedFrom });

    if (agent) {
      logger.info('prefactor_session_ready', { sessionKey });
    }
  });

  api.on('session_end', (event, ctx) => {
    const sessionKey = ctx.sessionId;
    const timestamp = Date.now();

    logger.info('session_end', { sessionKey, timestamp, messageCount: event.messageCount });

    sessionManager
      .closeSessionSpan(sessionKey)
      .then(() => agent?.finishAgentInstance(sessionKey, 'complete'))
      .catch((err) => {
        logger.error('prefactor_session_finish_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  });

  // ==================== AGENT LIFECYCLE ====================

  api.on('before_model_resolve', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';
    logger.info('before_model_resolve', {
      sessionKey,
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      hasPrompt: !!event.prompt,
    });
  });

  api.on('before_prompt_build', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';
    logger.info('before_prompt_build', {
      sessionKey,
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      messageCount: event.messages?.length || 0,
    });
  });

  api.on('before_agent_start', (event, ctx) => {
    const sessionKey = ctx.sessionKey;
    if (!sessionKey) {
      logger.warn('prefactor_skipped_no_session_key', {
        hook: 'before_agent_start',
      });
      return;
    }

    logger.info('before_agent_start', {
      sessionKey,
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      messageCount: event.messages?.length || 0,
    });

    const userMsg = pendingUserMessage;
    pendingUserMessage = null;

    const work = async () => {
      if (userMsg) {
        await sessionManager.createUserMessageSpan(sessionKey, { raw: userMsg });
      }
      const messages = (event.messages ?? []).slice(-3);
      await sessionManager.createAgentRunSpan(sessionKey, {
        event: { ...event, messages },
        ctx,
      });
    };

    work().catch((err) => {
      logger.error('prefactor_agent_run_span_failed', {
        sessionKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  api.on('llm_input', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';
    logger.info('llm_input', {
      sessionKey,
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      runId: event.runId,
      sessionId: event.sessionId,
      provider: event.provider,
      model: event.model,
      hasSystemPrompt: !!event.systemPrompt,
      systemPromptPreview: event.systemPrompt ? event.systemPrompt.slice(0, 200) : undefined,
      promptPreview: event.prompt ? event.prompt.slice(0, 200) : undefined,
      historyMessagesCount: event.historyMessages?.length || 0,
      imagesCount: event.imagesCount,
    });
  });

  api.on('llm_output', (event, ctx) => {
    const sessionKey = ctx.sessionKey;
    if (!sessionKey) {
      logger.warn('prefactor_skipped_no_session_key', {
        hook: 'llm_output',
      });
      return;
    }

    const assistantText =
      event.assistantTexts && event.assistantTexts.length > 0 ? event.assistantTexts[0] || '' : '';

    const tokens = event.usage
      ? {
          input: event.usage.input,
          output: event.usage.output,
          cacheRead: event.usage.cacheRead,
          cacheWrite: event.usage.cacheWrite,
        }
      : undefined;

    const metadata = {
      provider: event.provider,
      model: event.model,
    };

    logger.info('llm_output', {
      sessionKey,
      ctxKeys: Object.keys(ctx),
      eventKeys: Object.keys(event),
      runId: event.runId,
      sessionId: event.sessionId,
      provider: event.provider,
      model: event.model,
      assistantTextsCount: event.assistantTexts?.length || 0,
      assistantTextPreview: assistantText.slice(0, 200),
      usageInput: tokens?.input,
      usageOutput: tokens?.output,
      usageCacheRead: tokens?.cacheRead,
      usageCacheWrite: tokens?.cacheWrite,
      hasLastAssistant: !!event.lastAssistant,
    });

    const thinkingBlocks: Array<{ thinking: string; signature?: string }> = [];

    if (event.lastAssistant) {
      const lastAsst = event.lastAssistant as Record<string, unknown>;
      logger.debug('llm_output_last_assistant', {
        sessionKey,
        lastAssistantKeys: Object.keys(lastAsst),
        hasContent: !!lastAsst.content,
        contentType: Array.isArray(lastAsst.content) ? 'array' : typeof lastAsst.content,
        contentLength: Array.isArray(lastAsst.content) ? lastAsst.content.length : undefined,
      });

      if (Array.isArray(lastAsst.content)) {
        for (let i = 0; i < lastAsst.content.length; i++) {
          const block = lastAsst.content[i] as Record<string, unknown>;
          if (block?.type === 'thinking' && typeof block.thinking === 'string') {
            thinkingBlocks.push({
              thinking: block.thinking,
              signature:
                typeof block.thinkingSignature === 'string' ? block.thinkingSignature : undefined,
            });
            logger.debug('llm_output_thinking_block', {
              sessionKey,
              blockIndex: i,
              thinkingLength: block.thinking.length,
              signature: block.thinkingSignature,
            });
          }
        }
      }
    }

    const processLLMOutput = async () => {
      for (const block of thinkingBlocks) {
        await sessionManager.createAgentThinkingSpan(sessionKey, block.thinking, tokens, {
          ...metadata,
          signature: block.signature,
        });
      }

      await sessionManager.createAssistantResponseSpan(sessionKey, assistantText, tokens, metadata);
    };

    processLLMOutput().catch((err) => {
      logger.error('prefactor_llm_output_span_failed', {
        sessionKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  api.on('agent_end', (event, ctx) => {
    const sessionKey = ctx.sessionKey;
    if (!sessionKey) {
      logger.warn('prefactor_skipped_no_session_key', {
        hook: 'agent_end',
      });
      return;
    }

    logger.info('agent_end', {
      sessionKey,
      ctxKeys: Object.keys(ctx),
      eventKeys: Object.keys(event),
      messageCount: event.messages?.length || 0,
      success: event.success,
      durationMs: event.durationMs,
    });

    sessionManager
      .closeAgentRunSpan(sessionKey, event.success ? 'complete' : 'failed')
      .catch((err) => {
        logger.error('prefactor_agent_end_span_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  });

  // ==================== COMPACTION LIFECYCLE ====================

  api.on('before_compaction', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';

    logger.info('before_compaction', {
      sessionKey,
      messageCount: event.messageCount,
      tokenCount: event.tokenCount,
    });
  });

  api.on('after_compaction', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';

    logger.info('after_compaction', {
      sessionKey,
      messageCount: event.messageCount,
      tokenCount: event.tokenCount,
      compactedCount: event.compactedCount,
    });
  });

  api.on('before_reset', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';
    logger.info('before_reset', {
      sessionKey,
      reason: event.reason,
    });
  });

  // ==================== TOOL LIFECYCLE ====================

  api.on('before_tool_call', (event, ctx) => {
    const sessionKey = ctx.sessionKey;
    const toolName = event.toolName;

    logger.info('before_tool_call', {
      sessionKey: sessionKey || 'missing',
      tool: toolName,
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      params: JSON.stringify(event.params || {}).slice(0, 300),
    });

    if (!sessionKey) {
      logger.warn('prefactor_skipped_no_session_key', {
        hook: 'before_tool_call',
        tool: event.toolName,
      });
      return;
    }

    sessionManager
      .createToolCallSpan(sessionKey, toolName, { toolName, event, ctx })
      .catch((err) => {
        logger.error('prefactor_tool_call_span_failed', {
          sessionKey,
          tool: toolName,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  });

  api.on('after_tool_call', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';
    const toolName = event.toolName;

    logger.info('after_tool_call', {
      sessionKey,
      tool: toolName,
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      durationMs: event.durationMs,
      error: event.error,
      hasResult: event.result !== undefined,
      resultType: event.result !== undefined ? typeof event.result : 'undefined',
      resultPreview:
        event.result !== undefined ? JSON.stringify(event.result).slice(0, 300) : 'undefined',
    });
  });

  api.on('tool_result_persist', (event, ctx) => {
    const sessionKey = ctx.sessionKey;
    const toolCallId = event.toolCallId || ctx.toolCallId || '';
    const toolName = ctx.toolName || event.toolName || 'unknown';

    logger.info('tool_result_persist', {
      sessionKey: sessionKey || 'missing',
      tool: toolName,
      toolCallId,
      ctxKeys: Object.keys(ctx),
      eventKeys: Object.keys(event),
      isSynthetic: event.isSynthetic,
      hasMessage: !!event.message,
    });

    if (!sessionKey) {
      logger.warn('prefactor_skipped_no_session_key', {
        hook: 'tool_result_persist',
        tool: toolName,
      });
      return { message: event.message };
    }

    // Extract result text from message.content
    let resultText: string | undefined;
    let isError = false;

    if (event.message) {
      const msg = event.message as unknown as Record<string, unknown>;
      isError = msg.isError === true;

      const content = msg.content;
      if (Array.isArray(content) && content.length > 0) {
        const firstItem = content[0] as Record<string, unknown> | undefined;
        if (firstItem?.type === 'text' && typeof firstItem.text === 'string') {
          resultText = firstItem.text;
        }
      }
    }

    sessionManager
      .closeToolCallSpanWithResult(sessionKey, toolCallId, toolName, resultText, isError)
      .catch((err) => {
        logger.error('prefactor_close_tool_span_failed', {
          sessionKey,
          tool: toolName,
          toolCallId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return { message: event.message };
  });

  api.on('before_message_write', (event, ctx) => {
    const sessionKey = ctx.sessionKey || event.sessionKey || 'unknown';

    logger.info('before_message_write', {
      sessionKey,
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      hasMessage: !!event.message,
      messageKeys: event.message ? Object.keys(event.message) : [],
      messageRole: (event.message as unknown as Record<string, unknown>)?.role,
      messagePreview: event.message ? JSON.stringify(event.message).slice(0, 500) : 'undefined',
    });
  });

  // ==================== MESSAGE LIFECYCLE ====================

  api.on('message_received', (event, ctx) => {
    const preview = event.content ? event.content.slice(0, 50) : '';

    logger.info('message_received', {
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      from: event.from,
      preview,
      hasContent: !!event.content,
    });

    pendingUserMessage = {
      from: event.from,
      content: event.content,
      channelId: ctx.channelId,
    };
  });

  api.on('message_sending', (event, ctx) => {
    logger.info('message_sending', {
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      to: event.to,
      hasContent: !!event.content,
      contentPreview: event.content ? event.content.slice(0, 200) : undefined,
    });
  });

  api.on('message_sent', (event, ctx) => {
    logger.info('message_sent', {
      ctxKeys: Object.keys(ctx),
      ctx: JSON.stringify(ctx).slice(0, 500),
      eventKeys: Object.keys(event),
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      to: event.to,
      success: event.success,
      error: event.error,
    });
  });

  // ==================== SUBAGENT LIFECYCLE ====================

  api.on('subagent_spawning', (event, ctx) => {
    logger.info('subagent_spawning', {
      childSessionKey: event.childSessionKey,
      agentId: event.agentId,
      label: event.label,
      mode: event.mode,
    });
  });

  api.on('subagent_delivery_target', (event, ctx) => {
    logger.info('subagent_delivery_target', {
      event: JSON.stringify(event).slice(0, 200),
    });
  });

  api.on('subagent_spawned', (event, ctx) => {
    logger.info('subagent_spawned', {
      event: JSON.stringify(event).slice(0, 200),
    });
  });

  api.on('subagent_ended', (event, ctx) => {
    logger.info('subagent_ended', {
      targetSessionKey: event.targetSessionKey,
      targetKind: event.targetKind,
      reason: event.reason,
      outcome: event.outcome,
      error: event.error,
    });
  });

  logger.info('plugin_registered_prefactor', {
    hooks: 24,
    logLevel,
    agentInitialized,
  });
}

// Re-export types for TypeDoc visibility
export type { Agent, AgentConfig } from './agent.js';
export { createAgent } from './agent.js';
export type { Logger, LogLevel } from './logger.js';
export { createLogger } from './logger.js';
export type { SessionStateManager } from './session-state.js';
export { createSessionStateManager } from './session-state.js';
