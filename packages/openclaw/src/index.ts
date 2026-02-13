import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { type Agent, type AgentConfig, createAgent } from './agent.js';
import { createLogger } from './logger.js';
import { createSessionStateManager } from './session-state.js';

// Zod schema for config validation
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
  // Parse and validate config using Zod
  const config = prefactorConfigSchema.parse(api.pluginConfig || defaultConfig);

  const logLevel = config.logLevel;
  const logger = createLogger(logLevel);

  // Initialize Prefactor Agent if config is present
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

  // Initialize Session State Manager for hierarchical span tracking
  const sessionManager = createSessionStateManager(agent, logger, {
    userInteractionTimeoutMs: config.userInteractionTimeoutMinutes * 60 * 1000,
    sessionTimeoutMs: config.sessionTimeoutHours * 60 * 60 * 1000,
  });

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

    if (agent) {
      agent.finishAgentInstance(sessionKey, 'complete').catch((err) => {
        logger.error('prefactor_session_finish_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // ==================== AGENT LIFECYCLE ====================

  api.on('before_agent_start', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';

    logger.info('before_agent_start', { sessionKey });

    // Create agent_run span
    sessionManager.createAgentRunSpan(sessionKey, { event, ctx }).catch((err) => {
      logger.error('prefactor_agent_run_span_failed', {
        sessionKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  api.on('agent_end', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';
    const endTime = Date.now();
    const messageCount = event.messages?.length || 0;

    logger.info('agent_end', {
      sessionKey,
      endTime,
      messageCount,
      success: event.success,
      durationMs: event.durationMs,
    });

    // Close agent_run span and create assistant_response span
    sessionManager
      .closeAgentRunSpan(sessionKey, event.success ? 'complete' : 'failed')
      .then(() => {
        return sessionManager.createAssistantResponseSpan(sessionKey, { event, ctx });
      })
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

  // ==================== TOOL LIFECYCLE ====================

  api.on('before_tool_call', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';
    const toolName = event.toolName;

    logger.info('before_tool_call', { sessionKey, tool: toolName });

    // Create tool_call span
    sessionManager.createToolCallSpan(sessionKey, toolName, { event, ctx }).catch((err) => {
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
      durationMs: event.durationMs,
      error: event.error,
      note: 'This hook is broken in OpenClaw but we handle cleanup elsewhere',
    });
  });

  api.on('tool_result_persist', (event, ctx) => {
    const sessionKey = ctx.sessionKey || 'unknown';
    const toolName = ctx.toolName || event.toolName || 'unknown';

    logger.info('tool_result_persist', { sessionKey, tool: toolName });

    // Close the tool_call span (pass toolName for concurrent tool call matching)
    sessionManager.closeToolCallSpan(sessionKey, 'complete', toolName).catch((err) => {
      logger.error('prefactor_close_tool_span_failed', {
        sessionKey,
        tool: toolName,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Return the message unchanged (or modify if needed)
    return { message: event.message };
  });

  // ==================== MESSAGE LIFECYCLE ====================

  // Note: Message hooks use PluginHookMessageContext which has channelId/conversationId
  // but NOT sessionKey. Span management is handled by agent hooks (before_agent_start,
  // agent_end) which have the correct sessionKey. These hooks are logging-only.

  api.on('message_received', (event, ctx) => {
    const preview = event.content ? event.content.slice(0, 50) : '';

    logger.info('message_received', {
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      from: event.from,
      preview,
    });
  });

  api.on('message_sending', (event, ctx) => {
    logger.info('message_sending', {
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      to: event.to,
      hasContent: event.content ? 'yes' : 'no',
    });
  });

  api.on('message_sent', (event, ctx) => {
    logger.info('message_sent', {
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      to: event.to,
      success: event.success,
      error: event.error,
    });
  });

  logger.info('plugin_registered_prefactor', {
    hooks: 14,
    logLevel,
    agentInitialized,
  });
}
