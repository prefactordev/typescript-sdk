// Prefactor Plugin - Comprehensive lifecycle event monitoring for OpenClaw
// Hooks into all 13 available lifecycle events with Prefactor Agent tracking

import { randomUUID } from 'crypto';
import { createLogger, LogLevel } from './src/logger.js';
import { createAgent, Agent, AgentConfig } from './src/agent.js';
import { createSessionStateManager, SessionStateManager } from './src/session-state.js';

// Plugin API type definition (minimal for TypeScript)
interface PluginAPI {
  logger: {
    debug: (msg: string, meta?: unknown) => void;
    info: (msg: string, meta?: unknown) => void;
    warn: (msg: string, meta?: unknown) => void;
    error: (msg: string, meta?: unknown) => void;
  };
  // OpenClaw passes the full config object, we extract plugin config from it
  config: Record<string, unknown>;
  on: (event: string, handler: (ctx: unknown) => unknown) => void;
  registerCli: (registerFn: (args: { program: unknown }) => void) => void;
  version?: string;
}

// Hook context types
interface GatewayContext {
  timestamp?: number;
}

interface SessionContext {
  sessionKey: string;
  timestamp?: number;
}

interface AgentContext {
  sessionKey: string;
  messages?: unknown[];
  context?: {
    bootstrapFiles?: Array<{
      path: string;
      content: string;
    }>;
  };
  startTime?: number;
  endTime?: number;
}

interface CompactionContext {
  sessionKey: string;
  tokensBefore?: number;
  tokensAfter?: number;
}

interface ToolContext {
  sessionKey: string;
  toolName: string;
  params?: unknown;
  result?: unknown;
}

interface MessageContext {
  sessionKey: string;
  channel?: string;
  senderId?: string;
  recipient?: string;
  text?: string;
  messageId?: string;
}

export default function register(api: PluginAPI) {
  // The config passed by OpenClaw is the full config, we need to extract
  // the plugin-specific config from plugins.entries.prefactor.config
  const fullConfig = api.config || {};
  const pluginsConfig = (fullConfig.plugins as { entries?: Record<string, { config?: Record<string, unknown> }> }) || {};
  const pluginEntry = pluginsConfig.entries?.prefactor;
  const pluginConfig = pluginEntry?.config || {};

  // Merge plugin config with any top-level config (for backwards compatibility)
  const config: {
    apiUrl?: string;
    apiKey?: string;
    agentId?: string;
    agentVersion?: string;
    logLevel: LogLevel;
    userInteractionTimeoutMinutes: number;
    sessionTimeoutHours: number;
  } = {
    ...(pluginConfig as Record<string, unknown>),
    // Keep other top-level values if they exist
    logLevel: (pluginConfig.logLevel as LogLevel) || (fullConfig.logLevel as LogLevel) || 'info',
    userInteractionTimeoutMinutes: (pluginConfig.userInteractionTimeoutMinutes as number) || 5,
    sessionTimeoutHours: (pluginConfig.sessionTimeoutHours as number) || 24,
  };

  const logLevel = config.logLevel || 'info';

  const logger = createLogger(logLevel);

  // Debug: Log the plugin config extracted
  logger.info('prefactor_plugin_config', {
    hasApiUrl: !!config.apiUrl,
    hasApiKey: !!config.apiKey,
    hasAgentId: !!config.agentId,
    apiUrlLength: (config.apiUrl as string)?.length || 0,
    apiKeyLength: (config.apiKey as string)?.length || 0,
    agentId: (config.agentId as string) || 'missing',
    configKeys: Object.keys(config).join(','),
  });

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
        userAgentVersion: config.agentVersion || 'default',
        maxRetries: 3,
        initialRetryDelay: 1000,
        requestTimeout: 30000,
      };

      agent = createAgent(agentConfig, logger);
      agentInitialized = true;

      logger.info('prefactor_agent_initialized', {
        agentId: config.agentId,
        apiUrl: config.apiUrl,
        agentVersion: config.agentVersion || 'default',
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

  // Hook: gateway_start - Gateway is starting up
  api.on('gateway_start', (_ctx: unknown) => {
    const ctx = _ctx as GatewayContext;
    const timestamp = Date.now();

    logger.info('gateway_start', {
      timestamp,
      pid: process.pid,
      agentInitialized,
    });
  });

  // Hook: gateway_stop - Gateway is shutting down
  api.on('gateway_stop', (_ctx: unknown) => {
    const ctx = _ctx as GatewayContext;
    const timestamp = Date.now();

    logger.info('gateway_stop', {
      timestamp,
    });

    // Emergency cleanup for Prefactor Agent
    if (agent) {
      logger.info('prefactor_emergency_cleanup_start', {});
      agent.emergencyCleanup().then(() => {
        logger.info('prefactor_emergency_cleanup_complete', {});
      }).catch((err) => {
        logger.error('prefactor_emergency_cleanup_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Cleanup all sessions and spans
    sessionManager.cleanupAllSessions().then(() => {
      logger.info('prefactor_sessions_cleanup_complete', {});
    }).catch((err) => {
      logger.error('prefactor_sessions_cleanup_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Emergency cleanup for Prefactor Agent
    if (agent) {
      logger.info('prefactor_emergency_cleanup_start', {});
      agent.emergencyCleanup().then(() => {
        logger.info('prefactor_emergency_cleanup_complete', {});
      }).catch((err) => {
        logger.error('prefactor_emergency_cleanup_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // ==================== SESSION LIFECYCLE ====================

  // Hook: session_start - New session created
  api.on('session_start', (_ctx: unknown) => {
    const ctx = _ctx as SessionContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const timestamp = Date.now();

    logger.info('session_start', {
      sessionKey,
      timestamp,
    });

    // Log that we're ready to track spans for this session
    if (agent) {
      logger.info('prefactor_session_ready', {
        sessionKey,
      });
    }
  });

  // Hook: session_end - Session ended
  api.on('session_end', (_ctx: unknown) => {
    const ctx = _ctx as SessionContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const timestamp = Date.now();

    logger.info('session_end', {
      sessionKey,
      timestamp,
    });

    // Finish Prefactor AgentInstance for this session
    if (agent) {
      logger.info('prefactor_session_cleanup', {
        sessionKey,
      });

      agent.finishAgentInstance(sessionKey, 'complete').then(() => {
        logger.info('prefactor_session_finished', {
          sessionKey,
        });
      }).catch((err) => {
        logger.error('prefactor_session_finish_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // ==================== AGENT LIFECYCLE ====================

  // Hook: before_agent_start - Before agent run starts
  api.on('before_agent_start', (_ctx: unknown) => {
    const ctx = _ctx as AgentContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const startTime = Date.now();

    // Generate unique context marker
    const marker = `prefactor-${randomUUID()}`;

    logger.info('before_agent_start', {
      sessionKey,
      marker,
      startTime,
    });

    // Inject context marker into bootstrap files
    if (ctx?.context?.bootstrapFiles) {
      ctx.context.bootstrapFiles.push({
        path: 'PREFACTOR_MARKER.md',
        content: `# Prefactor Context Marker\n\nSession is being monitored by prefactor plugin.\nMarker: ${marker}\nTimestamp: ${new Date(startTime).toISOString()}`,
      });
      logger.debug('context_injected', { sessionKey, marker });
    }

    // Create agent_run span using hierarchical session manager
    if (sessionManager) {
      sessionManager.createAgentRunSpan(sessionKey, ctx).then((spanId) => {
        if (spanId) {
          logger.info('prefactor_agent_run_span_created_hierarchical', {
            sessionKey,
            spanId,
          });
        }
      }).catch((err) => {
        logger.error('prefactor_agent_run_span_failed_hierarchical', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // Hook: agent_end - After agent run completes
  api.on('agent_end', (_ctx: unknown) => {
    const ctx = _ctx as AgentContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const endTime = Date.now();
    const messageCount = ctx?.messages?.length || 0;

    logger.info('agent_end', {
      sessionKey,
      endTime,
      messageCount,
    });

    // Close agent_run span and create assistant_response span using session manager
    if (sessionManager) {
      sessionManager.closeAgentRunSpan(sessionKey, 'complete').then(() => {
        logger.info('prefactor_agent_run_span_closed_hierarchical', {
          sessionKey,
        });
        // Create assistant_response span as child of interaction
        return sessionManager.createAssistantResponseSpan(sessionKey, ctx);
      }).then((spanId) => {
        if (spanId) {
          logger.info('prefactor_assistant_response_span_created_hierarchical', {
            sessionKey,
            spanId,
          });
        }
      }).catch((err) => {
        logger.error('prefactor_agent_end_span_failed_hierarchical', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // ==================== COMPACTION LIFECYCLE ====================

  // Hook: before_compaction - Before context compaction
  api.on('before_compaction', (_ctx: unknown) => {
    const ctx = _ctx as CompactionContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const tokensBefore = ctx?.tokensBefore || 0;

    logger.info('before_compaction', {
      sessionKey,
      tokensBefore,
    });
  });

  // Hook: after_compaction - After context compaction
  api.on('after_compaction', (_ctx: unknown) => {
    const ctx = _ctx as CompactionContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const tokensAfter = ctx?.tokensAfter || 0;

    logger.info('after_compaction', {
      sessionKey,
      tokensAfter,
    });
  });

  // ==================== TOOL LIFECYCLE ====================

  // Hook: before_tool_call - Before tool execution
  api.on('before_tool_call', (_ctx: unknown) => {
    const ctx = _ctx as ToolContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const toolName = ctx?.toolName || 'unknown';

    logger.info('before_tool_call', {
      sessionKey,
      tool: toolName,
    });

    // Create tool_call span using hierarchical session manager
    if (sessionManager) {
      sessionManager.createToolCallSpan(sessionKey, toolName, ctx).then((spanId) => {
        if (spanId) {
          logger.info('prefactor_tool_call_span_created_hierarchical', {
            sessionKey,
            spanId,
            tool: toolName,
          });
        }
      }).catch((err) => {
        logger.error('prefactor_tool_call_span_failed_hierarchical', {
          sessionKey,
          tool: toolName,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // Hook: after_tool_call - After tool execution (BROKEN - never fires)
  // This is a known issue in OpenClaw core. We work around it by closing tool
  // spans when a new tool span is created or when the session ends.
  api.on('after_tool_call', (_ctx: unknown) => {
    const ctx = _ctx as ToolContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const toolName = ctx?.toolName || 'unknown';

    logger.info('after_tool_call', {
      sessionKey,
      tool: toolName,
      note: 'This hook is broken in OpenClaw but we handle cleanup elsewhere',
    });
  });

  // Hook: tool_result_persist - Synchronous transform before persistence
  // We use this as a signal that the tool has completed and close the span
  api.on('tool_result_persist', (_ctx: unknown) => {
    const ctx = _ctx as ToolContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const toolName = ctx?.toolName || 'unknown';

    logger.info('tool_result_persist', {
      sessionKey,
      tool: toolName,
    });

    // Close the tool_call span using hierarchical session manager
    if (sessionManager) {
      sessionManager.closeToolCallSpan(sessionKey, 'complete').then(() => {
        logger.info('prefactor_tool_call_span_closed_hierarchical', {
          sessionKey,
          tool: toolName,
        });
      }).catch((err) => {
        logger.error('prefactor_close_tool_span_failed_hierarchical', {
          sessionKey,
          tool: toolName,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Pass through unchanged (no transformation for POC)
    return ctx?.result;
  });

  // ==================== MESSAGE LIFECYCLE ====================

  // Hook: message_received - Inbound message received
  api.on('message_received', (_ctx: unknown) => {
    const ctx = _ctx as MessageContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const channel = ctx?.channel || 'unknown';
    const senderId = ctx?.senderId || 'unknown';
    const preview = ctx?.text ? ctx.text.slice(0, 50) : '';

    logger.info('message_received', {
      sessionKey,
      channel,
      sender: senderId,
      preview,
    });

    // Hierarchical span management:
    // 1. Ensure session span exists (24hr timeout)
    // 2. Create or get interaction span (5min timeout)
    // 3. Create user_message span (immediate event)
    if (sessionManager) {
      sessionManager.createSessionSpan(sessionKey).then(() => {
        return sessionManager.createOrGetInteractionSpan(sessionKey);
      }).then(() => {
        return sessionManager.createUserMessageSpan(sessionKey, ctx);
      }).then((spanId) => {
        if (spanId) {
          logger.info('prefactor_user_message_span_created', {
            sessionKey,
            spanId,
          });
        }
      }).catch((err) => {
        logger.error('prefactor_message_received_span_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // Hook: message_sending - Outbound message being sent
  api.on('message_sending', (_ctx: unknown) => {
    const ctx = _ctx as MessageContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const recipient = ctx?.recipient || 'unknown';
    const hasText = ctx?.text ? 'yes' : 'no';

    logger.info('message_sending', {
      sessionKey,
      recipient,
      hasText,
    });

    // Create assistant_message span
    if (agent) {
      agent.createAssistantMessageSpan(sessionKey, ctx).then((spanId) => {
        if (spanId) {
          logger.info('prefactor_assistant_message_span_created', {
            sessionKey,
            spanId,
          });
        }
      }).catch((err) => {
        logger.error('prefactor_assistant_message_span_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // Hook: message_sent - Outbound message confirmed sent
  api.on('message_sent', (_ctx: unknown) => {
    const ctx = _ctx as MessageContext;
    const sessionKey = ctx?.sessionKey || 'unknown';
    const messageId = ctx?.messageId || 'unknown';

    logger.info('message_sent', {
      sessionKey,
      messageId,
    });

    // Close assistant_message span
    if (agent) {
      agent.closeAssistantMessageSpan(sessionKey).then(() => {
        logger.info('prefactor_assistant_message_span_closed', {
          sessionKey,
        });
      }).catch((err) => {
        logger.error('prefactor_close_assistant_span_failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  logger.info('plugin_registered_prefactor', {
    hooks: 13,
    logLevel,
    agentInitialized,
  });
}
