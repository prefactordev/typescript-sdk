import { randomUUID } from 'node:crypto';
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
    const startTime = Date.now();
    const marker = `prefactor-${randomUUID()}`;

    logger.info('before_agent_start', { sessionKey, marker, startTime });

    // Create agent_run span
    sessionManager.createAgentRunSpan(sessionKey, { event, ctx }).catch((err) => {
      logger.error('prefactor_agent_run_span_failed', {
        sessionKey,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Inject context marker via prependContext
    logger.debug('context_injected', { sessionKey, marker });
    return {
      prependContext: `<!-- Prefactor session monitored. Marker: ${marker} Timestamp: ${new Date(startTime).toISOString()} -->`,
    };
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

    // Close the tool_call span
    sessionManager.closeToolCallSpan(sessionKey, 'complete').catch((err) => {
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

  api.on('message_received', (event, ctx) => {
    const sessionKey = ctx.conversationId || ctx.channelId;
    const preview = event.content ? event.content.slice(0, 50) : '';

    logger.info('message_received', {
      sessionKey,
      channelId: ctx.channelId,
      from: event.from,
      preview,
    });

    // Hierarchical span management
    sessionManager
      .createSessionSpan(sessionKey)
      .then(() => sessionManager.createOrGetInteractionSpan(sessionKey))
      .then(() => sessionManager.createUserMessageSpan(sessionKey, { event, ctx }))
      .then((spanId) => {
        if (spanId) {
          logger.info('prefactor_user_message_span_created', { sessionKey, spanId });
        }
      })
      .catch((err) => {
        logger.error('prefactor_message_received_span_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  });

  api.on('message_sending', (event, ctx) => {
    const sessionKey = ctx.conversationId || ctx.channelId;

    logger.info('message_sending', {
      sessionKey,
      to: event.to,
      hasContent: event.content ? 'yes' : 'no',
    });

    // Create assistant_message span
    agent
      ?.createAssistantMessageSpan(sessionKey, { event, ctx })
      .then((spanId) => {
        if (spanId) {
          logger.info('prefactor_assistant_message_span_created', { sessionKey, spanId });
        }
      })
      .catch((err) => {
        logger.error('prefactor_assistant_message_span_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  });

  api.on('message_sent', (event, ctx) => {
    const sessionKey = ctx.conversationId || ctx.channelId;

    logger.info('message_sent', {
      sessionKey,
      to: event.to,
      success: event.success,
      error: event.error,
    });

    // Close assistant_message span
    agent
      ?.closeAssistantMessageSpan(sessionKey)
      .then(() => {
        logger.info('prefactor_assistant_message_span_closed', { sessionKey });
      })
      .catch((err) => {
        logger.error('prefactor_close_assistant_span_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  });

  logger.info('plugin_registered_prefactor', {
    hooks: 14,
    logLevel,
    agentInitialized,
  });
}
