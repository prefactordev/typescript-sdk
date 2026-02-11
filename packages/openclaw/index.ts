// Prefactor Plugin - Lifecycle event monitoring for OpenClaw
// Hooks into all 13 lifecycle events with Prefactor tracking

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createLogger, LogLevel } from './src/logger.js';
import { createAgent, Agent, AgentConfig } from './src/agent.js';
import { createSessionStateManager, SessionStateManager } from './src/session-state.js';

// Zod schema for config validation
const prefactorConfigSchema = z
  .object({
    apiUrl: z.string().optional(),
    apiKey: z.string().optional(),
    agentId: z.string().optional(),
    agentVersion: z.string().optional().default('default'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
    userInteractionTimeoutMinutes: z.number().int().positive().optional().default(5),
    sessionTimeoutHours: z.number().int().positive().optional().default(24),
  })
  .strict();

// TypeScript type
export type PrefactorConfig = z.infer<typeof prefactorConfigSchema>;

// Custom config validator object (following OpenClaw pattern)
const prefetchorConfig = {
  parse: prefactorConfigSchema.parse.bind(prefactorConfigSchema),
  uiHints: {
    apiUrl: {
      label: 'Prefactor API URL',
      placeholder: 'https://api.prefactor.dev',
    },
    apiKey: {
      label: 'Prefactor API Key',
      sensitive: true,
      placeholder: 'sk_...',
    },
    agentId: {
      label: 'Agent ID',
      placeholder: 'your-agent-id',
    },
    agentVersion: {
      label: 'Agent Version Suffix',
      placeholder: 'default',
    },
    logLevel: {
      label: 'Log Level',
      placeholder: 'info',
    },
    userInteractionTimeoutMinutes: {
      label: 'User Interaction Timeout (minutes)',
    },
    sessionTimeoutHours: {
      label: 'Session Span Timeout (hours)',
    },
  },
};

const prefactorPlugin = {
  id: 'prefactor',
  name: 'Prefactor Monitoring',
  description: 'Lifecycle event monitoring and instrumentation for OpenClaw',
  configSchema: prefetchorConfig,
  register(api: OpenClawPluginApi) {
    // Parse and validate config using Zod
    const config = prefetchorConfig.parse(api.pluginConfig);

    const logLevel = config.logLevel;
    const logger = createLogger(logLevel);

    // Initialize Prefactor Agent if config is present
    let agent: Agent | null = null;
    let agentInitialized = false;

    if (config.apiUrl && config.apiKey && config.agentId) {
      try {
        const agentConfig: AgentConfig = {
          apiUrl: config.apiUrl,
          apiToken: config.apiKey,
          agentId: config.agentId,
          openclawVersion: api.version || 'unknown',
          pluginVersion: '0.0.0',
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
          !config.apiKey && 'apiKey',
          !config.agentId && 'agentId',
        ].filter(Boolean),
      });
    }

    logger.info('plugin_init_prefactor', {
      logLevel,
      agentInitialized,
      version: '0.0.0',
    });

    // Initialize Session State Manager for hierarchical span tracking
    const sessionManager = createSessionStateManager(agent, logger, {
      userInteractionTimeoutMs: config.userInteractionTimeoutMinutes * 60 * 1000,
      sessionTimeoutMs: config.sessionTimeoutHours * 60 * 60 * 1000,
    });

    // ==================== GATEWAY LIFECYCLE ====================

    api.on('gateway_start', () => {
      const timestamp = Date.now();
      logger.info('gateway_start', {
        timestamp,
        pid: process.pid,
        agentInitialized,
      });
    });

    api.on('gateway_stop', () => {
      const timestamp = Date.now();
      logger.info('gateway_stop', { timestamp });

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

    api.on('session_start', (ctx: unknown) => {
      const sessionCtx = ctx as { sessionKey: string; timestamp?: number };
      const sessionKey = sessionCtx?.sessionKey || 'unknown';
      const timestamp = Date.now();

      logger.info('session_start', { sessionKey, timestamp });

      if (agent) {
        logger.info('prefactor_session_ready', { sessionKey });
      }
    });

    api.on('session_end', (ctx: unknown) => {
      const sessionCtx = ctx as { sessionKey: string; timestamp?: number };
      const sessionKey = sessionCtx?.sessionKey || 'unknown';
      const timestamp = Date.now();

      logger.info('session_end', { sessionKey, timestamp });

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

    api.on('before_agent_start', (ctx: unknown) => {
      const agentCtx = ctx as {
        sessionKey: string;
        messages?: unknown[];
        context?: { bootstrapFiles?: Array<{ path: string; content: string }> };
        startTime?: number;
      };

      const sessionKey = agentCtx?.sessionKey || 'unknown';
      const startTime = Date.now();
      const marker = `prefactor-${randomUUID()}`;

      logger.info('before_agent_start', { sessionKey, marker, startTime });

      // Inject context marker into bootstrap files
      if (agentCtx?.context?.bootstrapFiles) {
        agentCtx.context.bootstrapFiles.push({
          path: 'PREFACTOR_MARKER.md',
          content: `# Prefactor Context Marker\n\nSession is being monitored by prefactor plugin.\nMarker: ${marker}\nTimestamp: ${new Date(startTime).toISOString()}`,
        });
        logger.debug('context_injected', { sessionKey, marker });
      }

      // Create agent_run span
      sessionManager.createAgentRunSpan(sessionKey, agentCtx).catch((err) => {
        logger.error('prefactor_agent_run_span_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    api.on('agent_end', (ctx: unknown) => {
      const agentCtx = ctx as {
        sessionKey: string;
        messages?: unknown[];
        startTime?: number;
        endTime?: number;
      };

      const sessionKey = agentCtx?.sessionKey || 'unknown';
      const endTime = Date.now();
      const messageCount = agentCtx?.messages?.length || 0;

      logger.info('agent_end', { sessionKey, endTime, messageCount });

      // Close agent_run span and create assistant_response span
      sessionManager
        .closeAgentRunSpan(sessionKey, 'complete')
        .then(() => {
          return sessionManager.createAssistantResponseSpan(sessionKey, agentCtx);
        })
        .catch((err) => {
          logger.error('prefactor_agent_end_span_failed', {
            sessionKey,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    });

    // ==================== COMPACTION LIFECYCLE ====================

    api.on('before_compaction', (ctx: unknown) => {
      const compactionCtx = ctx as { sessionKey: string; tokensBefore?: number };
      const sessionKey = compactionCtx?.sessionKey || 'unknown';
      const tokensBefore = compactionCtx?.tokensBefore || 0;

      logger.info('before_compaction', { sessionKey, tokensBefore });
    });

    api.on('after_compaction', (ctx: unknown) => {
      const compactionCtx = ctx as { sessionKey: string; tokensAfter?: number };
      const sessionKey = compactionCtx?.sessionKey || 'unknown';
      const tokensAfter = compactionCtx?.tokensAfter || 0;

      logger.info('after_compaction', { sessionKey, tokensAfter });
    });

    // ==================== TOOL LIFECYCLE ====================

    api.on('before_tool_call', (ctx: unknown) => {
      const toolCtx = ctx as { sessionKey: string; toolName: string; params?: unknown };
      const sessionKey = toolCtx?.sessionKey || 'unknown';
      const toolName = toolCtx?.toolName || 'unknown';

      logger.info('before_tool_call', { sessionKey, tool: toolName });

      // Create tool_call span
      sessionManager.createToolCallSpan(sessionKey, toolName, toolCtx).catch((err) => {
        logger.error('prefactor_tool_call_span_failed', {
          sessionKey,
          tool: toolName,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    api.on('after_tool_call', (ctx: unknown) => {
      const toolCtx = ctx as { sessionKey: string; toolName: string };
      const sessionKey = toolCtx?.sessionKey || 'unknown';
      const toolName = toolCtx?.toolName || 'unknown';

      logger.info('after_tool_call', {
        sessionKey,
        tool: toolName,
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

    api.on('message_received', (ctx: unknown) => {
      const msgCtx = ctx as {
        sessionKey: string;
        channel?: string;
        senderId?: string;
        text?: string;
      };

      const sessionKey = msgCtx?.sessionKey || 'unknown';
      const channel = msgCtx?.channel || 'unknown';
      const senderId = msgCtx?.senderId || 'unknown';
      const preview = msgCtx?.text ? msgCtx.text.slice(0, 50) : '';

      logger.info('message_received', { sessionKey, channel, sender: senderId, preview });

      // Hierarchical span management
      sessionManager
        .createSessionSpan(sessionKey)
        .then(() => sessionManager.createOrGetInteractionSpan(sessionKey))
        .then(() => sessionManager.createUserMessageSpan(sessionKey, msgCtx))
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

    api.on('message_sending', (ctx: unknown) => {
      const msgCtx = ctx as {
        sessionKey: string;
        recipient?: string;
        text?: string;
      };

      const sessionKey = msgCtx?.sessionKey || 'unknown';
      const recipient = msgCtx?.recipient || 'unknown';
      const hasText = msgCtx?.text ? 'yes' : 'no';

      logger.info('message_sending', { sessionKey, recipient, hasText });

      // Create assistant_message span
      agent
        ?.createAssistantMessageSpan(sessionKey, msgCtx)
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

    api.on('message_sent', (ctx: unknown) => {
      const msgCtx = ctx as { sessionKey: string; messageId?: string };

      const sessionKey = msgCtx?.sessionKey || 'unknown';
      const messageId = msgCtx?.messageId || 'unknown';

      logger.info('message_sent', { sessionKey, messageId });

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
      hooks: 13,
      logLevel,
      agentInitialized,
    });
  },
};

export default prefactorPlugin;
