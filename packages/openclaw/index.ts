// Prefactor Plugin - Comprehensive lifecycle event monitoring for OpenClaw
// Hooks into all 13 available lifecycle events with Prefactor Agent tracking

import { randomUUID } from 'crypto';
import { createLogger, LogLevel } from './src/logger.js';
import { createMetrics } from './src/metrics.js';
import { createAgent, Agent, AgentConfig } from './src/agent.js';

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
  // the plugin-specific config from plugins.entries[prefactor-openclaw].config
  const fullConfig = api.config || {};
  const pluginsConfig = (fullConfig.plugins as { entries?: Record<string, { config?: Record<string, unknown> }> }) || {};
  const pluginEntry = pluginsConfig.entries?.['prefactor-openclaw'];
  const pluginConfig = pluginEntry?.config || {};

  // Merge plugin config with any top-level config (for backwards compatibility)
  const config: {
    apiUrl?: string;
    apiKey?: string;
    agentId?: string;
    agentVersion?: string;
    logLevel: LogLevel;
    enableMetrics: boolean;
  } = {
    ...(pluginConfig as Record<string, unknown>),
    // Keep other top-level values if they exist
    logLevel: (pluginConfig.logLevel as LogLevel) || (fullConfig.logLevel as LogLevel) || 'info',
    enableMetrics: pluginConfig.enableMetrics !== false && fullConfig.enableMetrics !== false,
  };

  const logLevel = config.logLevel || 'info';
  const enableMetrics = config.enableMetrics !== false;

  const logger = createLogger(logLevel);
  const metrics = createMetrics(enableMetrics);

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
        pluginVersion: '1.0.0',
        userAgentVersion: config.agentVersion || 'default',
        maxRetries: 3,
        retryDelay: 1000,
        timeout: 30000,
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
    enableMetrics,
    agentInitialized,
    version: '1.0.0',
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('gateway_start');
      metrics.recordGatewayStart();
    }
  });

  // Hook: gateway_stop - Gateway is shutting down
  api.on('gateway_stop', (_ctx: unknown) => {
    const ctx = _ctx as GatewayContext;
    const timestamp = Date.now();

    logger.info('gateway_stop', {
      timestamp,
    });

    if (metrics.isEnabled()) {
      metrics.recordEvent('gateway_stop');
      metrics.recordGatewayStop();
    }

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

    // Log final metrics summary
    if (metrics.isEnabled()) {
      const summary = metrics.getSummary();
      logger.info('metrics_summary', summary);
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('session_start');
      metrics.recordSessionStart(sessionKey);
    }

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

    if (metrics.isEnabled()) {
      metrics.recordEvent('session_end');
      metrics.recordSessionEnd(sessionKey);
    }

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

    if (metrics.isEnabled()) {
      metrics.recordEvent('before_agent_start');
    }

    // Create agent_run span in Prefactor
    if (agent) {
      agent.createAgentRunSpan(sessionKey, ctx).then((spanId) => {
        if (spanId) {
          logger.info('prefactor_agent_run_span_created', {
            sessionKey,
            spanId,
          });
        }
      }).catch((err) => {
        logger.error('prefactor_agent_run_span_failed', {
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('agent_end');
    }

    // Close agent_run span (it should be at the bottom of the stack)
    if (agent) {
      // Close all spans including agent_run
      agent.closeAllSpans(sessionKey).then(() => {
        logger.info('prefactor_agent_spans_closed', {
          sessionKey,
        });
      }).catch((err) => {
        logger.error('prefactor_close_spans_failed', {
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('before_compaction');
    }
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('after_compaction');
    }
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('before_tool_call');
    }

    // Create tool_call span (closes any previous tool span as workaround)
    if (agent) {
      agent.createToolCallSpan(sessionKey, toolName, ctx).then((spanId) => {
        if (spanId) {
          logger.info('prefactor_tool_call_span_created', {
            sessionKey,
            spanId,
            tool: toolName,
          });
        }
      }).catch((err) => {
        logger.error('prefactor_tool_call_span_failed', {
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('after_tool_call');
    }
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('tool_result_persist');
    }

    // Close the tool_call span since after_tool_call never fires
    if (agent) {
      agent.closeToolCallSpan(sessionKey).then(() => {
        logger.info('prefactor_tool_call_span_closed', {
          sessionKey,
          tool: toolName,
        });
      }).catch((err) => {
        logger.error('prefactor_close_tool_span_failed', {
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('message_received');
    }

    // Create user_message span (auto-closes immediately)
    if (agent) {
      agent.createUserMessageSpan(sessionKey, ctx).then((spanId) => {
        if (spanId) {
          logger.info('prefactor_user_message_span_created', {
            sessionKey,
            spanId,
          });
        }
      }).catch((err) => {
        logger.error('prefactor_user_message_span_failed', {
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

    if (metrics.isEnabled()) {
      metrics.recordEvent('message_sending');
    }

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

    if (metrics.isEnabled()) {
      metrics.recordEvent('message_sent');
    }

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

  // ==================== CLI COMMAND ====================

  // Register CLI command for metrics/status
  api.registerCli(({ program }: { program: any }) => {
    program
      .command('prefactor:status')
      .description('Show prefactor plugin status and metrics')
      .action(() => {
        console.log('=== Prefactor Plugin Status ===');
        console.log('Version: 1.0.0');
        console.log('Log Level:', logLevel);
        console.log('Metrics Enabled:', enableMetrics);
        console.log('Prefactor Agent Initialized:', agentInitialized);

        if (config.apiUrl) {
          console.log('API URL:', config.apiUrl);
        }
        if (config.agentId) {
          console.log('Agent ID:', config.agentId);
        }
        if (config.agentVersion) {
          console.log('Agent Version:', config.agentVersion);
        }

        if (metrics.isEnabled()) {
          const summary = metrics.getSummary();
          console.log('\n=== Metrics Summary ===');
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log('\nMetrics are disabled.');
        }
      });
  });

  logger.info('plugin_registered_prefactor', {
    hooks: 13,
    logLevel,
    metricsEnabled: enableMetrics,
    agentInitialized,
  });
}
