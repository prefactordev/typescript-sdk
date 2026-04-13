/**
 * Pi Prefactor Extension - MVP
 *
 * Instruments pi coding agent with Prefactor spans for distributed tracing.
 *
 * @module
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import packageJson from '../package.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { loadConfig, validateConfig, getConfigSummary, getConfigErrorMessage } from './config.js';
import { createLogger } from './logger.js';
import { createAgent } from './agent.js';
import { createSessionStateManager } from './session-state.js';

// Global state for pending user message
let pendingUserMessage: { text: string; timestamp: number } | null = null;

/**
 * Get stable session key from context
 */
function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionFile() ?? `ephemeral-${Date.now()}`;
}

/**
 * Extract text from message content
 */
function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const textParts: string[] = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    }
  }
  return textParts.join('\n');
}

/**
 * Extract thinking/reasoning from assistant message content
 * Looks for common thinking patterns: <thinking>, <think>, <reasoning>, etc.
 */
function extractThinkingFromContent(content: unknown): string | undefined {
  const text = extractTextFromContent(content);
  if (!text) return undefined;

  // Pattern 1: <thinking>...</thinking>
  const thinkingTagMatch = text.match(/<thinking>[\s\S]*?<\/thinking>/i);
  if (thinkingTagMatch) {
    return thinkingTagMatch[0]
      .replace(/<thinking>[\s\S]*?>([\s\S]*?)<\/thinking>/i, '$1')
      .trim();
  }

  // Pattern 2: <think>...</think>
  const thinkTagMatch = text.match(/<think>[\s\S]*?<\/think>/i);
  if (thinkTagMatch) {
    return thinkTagMatch[0]
      .replace(/<think>[\s\S]*?>([\s\S]*?)<\/think>/i, '$1')
      .trim();
  }

  // Pattern 3: <reasoning>...</reasoning>
  const reasoningTagMatch = text.match(/<reasoning>[\s\S]*?<\/reasoning>/i);
  if (reasoningTagMatch) {
    return reasoningTagMatch[0]
      .replace(/<reasoning>[\s\S]*?>([\s\S]*?)<\/reasoning>/i, '$1')
      .trim();
  }

  return undefined;
}

/**
 * Extract file path from tool result content (P0 Critical Fix #5)
 * Parses paths from result messages like "Successfully wrote to /path/to/file.txt"
 */
function extractPathFromToolResult(resultText: string, toolName: string): string | undefined {
  if (!resultText) return undefined;

  if (toolName === 'write') {
    // Pattern: "Successfully wrote X bytes to /path/to/file.txt"
    const writeMatch = resultText.match(/to\s+([\/\w\-.]+\.[\w-]+)/i);
    if (writeMatch && writeMatch[1]) {
      return writeMatch[1];
    }
  } else if (toolName === 'read') {
    // Pattern: "Read X bytes from /path/to/file.txt" or "File: /path/to/file.txt"
    const readMatch = resultText.match(/(?:from|File:)\s+([\/\w\-.]+\.[\w-]+)/i);
    if (readMatch && readMatch[1]) {
      return readMatch[1];
    }
  } else if (toolName === 'edit') {
    // Pattern: "Edited /path/to/file.txt" or "Modified /path/to/file.txt"
    const editMatch = resultText.match(/(?:Edited|Modified)\s+([\/\w\-.]+\.[\w-]+)/i);
    if (editMatch && editMatch[1]) {
      return editMatch[1];
    }
  }

  return undefined;
}

/**
 * Register configuration command
 */
function registerConfigCommand(pi: ExtensionAPI, config: any) {
  pi.registerCommand('prefactor-config', {
    description: 'Show Prefactor extension configuration status',
    handler: async (_args, ctx) => {
      const validation = validateConfig(config);
      const summary = validation.ok ? getConfigSummary(config) : { status: 'invalid' };

      const msg =
        `Prefactor Extension Configuration:\n\n` +
        `Status: ${validation.ok ? '✅ Valid' : '❌ Invalid'}\n\n` +
        (validation.ok
          ? Object.entries(summary)
              .map(([k, v]) => `- ${k}: ${v}`)
              .join('\n')
          : getConfigErrorMessage(validation));

      if (ctx.hasUI) {
        ctx.ui.notify(msg, validation.ok ? 'info' : 'error');
      } else {
        console.log(msg);
      }
    },
  });
}

/**
 * Main extension entry point
 */
export default function prefactorExtension(pi: ExtensionAPI) {
  // Load configuration
  const packageConfig = pi.getPackageConfig?.('pi-prefactor') ?? {};
  const config = loadConfig(packageConfig);
  const validation = validateConfig(config);

  // Validate configuration
  if (!validation.ok) {
    console.error('[pi-prefactor] Configuration error:', validation.error);
    console.error('[pi-prefactor] Required:', validation.missing?.join(', '));
    console.error('[pi-prefactor] Extension will not instrument spans');
    registerConfigCommand(pi, config);
    return;
  }

  // Initialize logger
  const logger = createLogger(config.logLevel);
  logger.debug('config_loaded', getConfigSummary(config));

  // Initialize Prefactor agent HTTP client
  const agent = createAgent(
    {
      apiUrl: config.apiUrl,
      apiToken: config.apiToken,
      agentId: config.agentId,
      agentName: config.agentName,
      agentVersion: config.agentVersion,
      piVersion: '0.66.0', // Pi version
      pluginVersion: packageJson.version || '0.0.1',
    },
    logger
  );

  // Initialize session state manager
  const sessionManager = createSessionStateManager(agent, logger, {
    userInteractionTimeoutMs: config.userInteractionTimeoutMinutes * 60 * 1000,
    sessionTimeoutMs: config.sessionTimeoutHours * 60 * 60 * 1000,
  });

  // ==================== PROCESS EXIT HANDLERS ====================

  // Graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    logger.debug('graceful_shutdown', { signal });
    try {
      await sessionManager.cleanupAllSessions();
      await agent.finishAgentInstance('*', 'complete');
    } catch (err) {
      logger.error('shutdown_error', { error: err });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Error handlers
  process.on('uncaughtException', async (err) => {
    logger.error('uncaught_exception', { error: err.message });
    try {
      await sessionManager.cleanupAllSessions();
    } catch (cleanupErr) {
      logger.error('cleanup_during_error_failed', { error: cleanupErr });
    }
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    logger.error('unhandled_rejection', { reason: String(reason) });
    try {
      await sessionManager.cleanupAllSessions();
    } catch (cleanupErr) {
      logger.error('cleanup_during_error_failed', { error: cleanupErr });
    }
    process.exit(1);
  });

  // Note: 'exit' event is synchronous, async cleanup won't complete
  // But we can at least log
  process.on('exit', (code) => {
    logger.debug('process_exit', { code });
  });

  // ==================== SESSION HOOKS ====================

  pi.on('session_start', async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    logger.debug('session_start', { reason: event.reason, sessionKey });
    await sessionManager.createSessionSpan(sessionKey);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    logger.debug('session_shutdown', { sessionKey });

    // P0 Critical Fix: Close agent_run span FIRST with comprehensive data before cleanup
    const state = sessionManager.getSessionState(sessionKey);

    if (state && state.agentRunSpanId) {
      logger.debug('session_shutdown_closing_agent_run', {
        sessionKey,
        hasState: true,
        filesModified: state.filesModified.size,
        toolCalls: state.toolCalls,
        commandsRun: state.commandsRun,
      });

      await sessionManager.closeAgentRunSpan(sessionKey, 'complete', {
        success: true, // Session shutdown is normal completion
        terminationReason: 'session_shutdown', // Use new terminationReason field
        filesModified: state.filesModified ? Array.from(state.filesModified) : [],
        filesRead: state.filesRead ? Array.from(state.filesRead) : [],
        filesCreated: state.filesCreated || [],
        commandsRun: state.commandsRun || 0,
        toolCalls: state.toolCalls || 0,
      });
    }

    // Close ALL remaining open spans with 'complete' status
    // (they're not failed, just not closed by their handlers)
    await sessionManager.closeAllOpenSpans(sessionKey, 'complete');

    // Then close session span
    await sessionManager.closeSessionSpan(sessionKey);

    // Finally finish agent instance
    await agent.finishAgentInstance(sessionKey, 'complete');
  });

  // ==================== INPUT HOOK ====================

  pi.on('input', async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    pendingUserMessage = { text: event.text, timestamp: Date.now() };

    logger.debug('input', {
      sessionKey,
      textPreview: event.text.slice(0, 50),
      source: event.source,
    });

    // Create user_message span directly (no interaction span)
    await sessionManager.createUserMessageSpan(sessionKey, pendingUserMessage);

    // Close the span immediately (message is complete once sent)
    await sessionManager.closeUserMessageSpan(sessionKey);

    // P0 Agent Run Improvement #7: Capture first user message as userRequest
    const state = sessionManager.getSessionState(sessionKey);
    if (state && !state.userRequest && event.source === 'user') {
      state.userRequest = event.text;
      logger.debug('user_request_captured', {
        sessionKey,
        userRequestPreview: event.text.slice(0, 50),
      });
    }
  });

  // ==================== AGENT HOOKS ====================

  pi.on('before_agent_start', async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    const startTime = Date.now();

    logger.debug('before_agent_start', {
      sessionKey,
      promptPreview: event.prompt?.slice(0, 50),
      messageCount: event.messages?.length,
    });

    if (pendingUserMessage) {
      pendingUserMessage = null;
    }

    // P0 Agent Run Improvements: Capture comprehensive agent run data
    // Task 1: Capture systemPrompt (actual text from ctx, not user prompt)
    const systemPrompt = ctx.systemPrompt || '';
    const maxSystemPromptLength = config.maxSystemPromptLength || 2000;

    const systemPromptHash = systemPrompt
      ? createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16)
      : undefined;

    // Task 2: Capture skillsLoaded
    const skillsLoaded = (ctx.skills || []).map((s: any) => s.name || s).filter(Boolean);

    // Task 3: Capture toolsAvailable
    const toolsAvailable = (ctx.tools || []).map((t: any) => t.name || t).filter(Boolean);

    // Task 7: Capture userRequest - use event.prompt (user's message) or state.userRequest
    const state = sessionManager.getSessionState(sessionKey);
    const userRequest = event.prompt || state?.userRequest;

    await sessionManager.createAgentRunSpan(sessionKey, {
      model: (ctx.model as any)?.id || 'unknown',
      temperature: (ctx.model as any)?.temperature,
      systemPrompt: systemPrompt.slice(0, maxSystemPromptLength),
      systemPromptHash: systemPromptHash,
      systemPromptLength: systemPrompt.length,
      skillsLoaded,
      toolsAvailable,
      userRequest,
    });

    // Track start time in session state for duration calculation
    const sessionState = sessionManager.getSessionState(sessionKey);
    if (sessionState) {
      (sessionState as any).agentRunStartTime = startTime;
      // Also store skills and tools in session state for reference
      sessionState.skillsLoaded = skillsLoaded;
      sessionState.toolsAvailable = toolsAvailable;
    }

    // Track startTime locally for duration calculation (don't send to backend)
    (sessionState as any).agentRunStartTime = startTime;
  });

  pi.on('agent_end', async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    const endTime = Date.now();

    logger.info('agent_end', {
      sessionKey,
      success: event.success,
      messageCount: event.messages?.length,
    });

    // P0 Critical Fix #4: Get session state for comprehensive agent run payload
    const state = sessionManager.getSessionState(sessionKey);

    // P0 Agent Run Improvement #4: Add token tracking
    const usage = event.usage || (event.result as any)?.usage;
    let tokens: { input: number; output: number; total: number } | undefined;

    if (usage) {
      tokens = {
        input: usage.promptTokens || usage.input_tokens || 0,
        output: usage.completionTokens || usage.output_tokens || 0,
        total: usage.totalTokens || usage.promptTokens + usage.completionTokens || 0,
      };
    }

    // P0 Agent Run Improvement #5: Fix terminationReason (no contradictions)
    let terminationReason: 'completed' | 'error' | 'user_cancel' | 'timeout' | 'session_shutdown';

    if (event.success === true) {
      terminationReason = 'completed';
    } else if (event.error) {
      terminationReason = 'error';
    } else if ((event as any).reason === 'user_cancel') {
      terminationReason = 'user_cancel';
    } else if ((event as any).reason === 'timeout') {
      terminationReason = 'timeout';
    } else {
      terminationReason = 'session_shutdown'; // Clean shutdown
    }

    // P0 Critical Fix #3, #4: Close agent run span with duration and comprehensive data
    // Only close if agent_run span still exists (session_shutdown may have already closed it)
    if (state && state.agentRunSpanId) {
      await sessionManager.closeAgentRunSpan(sessionKey, 'complete', {
        success: event.success ?? true,
        terminationReason,
        error: event.error || undefined,
        tokens,
        filesModified: state?.filesModified ? Array.from(state.filesModified) : [],
        filesRead: state?.filesRead ? Array.from(state.filesRead) : [],
        filesCreated: state?.filesCreated || [],
        commandsRun: state?.commandsRun || 0,
        toolCalls: state?.toolCalls || 0,
      });
      logger.info('agent_run_span_closed', { sessionKey });
    } else {
      logger.debug('agent_run_span_already_closed', { sessionKey });
    }
  });

  // ==================== TURN HOOKS - REMOVED ====================
  // pi:turn spans removed as low-value clutter (P0 Cleanup Task)

  // ==================== TOOL HOOKS ====================

  pi.on('tool_execution_start', async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    const startTime = Date.now();

    logger.debug('tool_execution_start', {
      sessionKey,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
    });

    // P0 Critical Fix #1: Determine schema name based on tool name - use SPECIFIC tool types
    let schemaName:
      | 'pi:tool:bash'
      | 'pi:tool:read'
      | 'pi:tool:write'
      | 'pi:tool:edit'
      | 'pi:tool_call' = 'pi:tool_call';

    if (event.toolName === 'bash') {
      schemaName = 'pi:tool:bash';
    } else if (event.toolName === 'read') {
      schemaName = 'pi:tool:read';
    } else if (event.toolName === 'write') {
      schemaName = 'pi:tool:write';
    } else if (event.toolName === 'edit') {
      schemaName = 'pi:tool:edit';
    }

    // P0 Critical Fix #2: Build tool-specific payload with start time for duration tracking
    const payload: Record<string, unknown> = {
      toolCallId: event.toolCallId,
      startTime: startTime, // CRITICAL: Track start time for duration
    };

    // P0 Critical Fix #5: Track file path at tool_execution_start time (args available here)
    const state = sessionManager.getSessionState(sessionKey);
    let toolPath: string | undefined;

    if (config.captureToolInputs) {
      if (event.toolName === 'bash') {
        const args = event.args as { command?: string; timeout?: number; cwd?: string };
        payload.command = args.command;
        payload.timeout = args.timeout;
        payload.cwd = args.cwd || process.cwd();
      } else if (event.toolName === 'read') {
        const args = event.args as { path?: string; offset?: number; limit?: number };
        toolPath = args.path;
        payload.path = args.path;
        payload.offset = args.offset;
        payload.limit = args.limit;
      } else if (event.toolName === 'write') {
        const args = event.args as { path?: string; content?: string };
        toolPath = args.path;
        payload.path = args.path;
        payload.contentLength = args.content?.length;
        payload.created = (event as any).created; // If available
      } else if (event.toolName === 'edit') {
        const args = event.args as { path?: string; edits?: any[] };
        toolPath = args.path;
        payload.path = args.path;
        payload.editCount = args.edits?.length;
      }
    }

    // CRITICAL: Await span creation to prevent race condition with tool_result
    await sessionManager.createToolCallSpan(sessionKey, event.toolName, payload, schemaName);

    // P0 Critical Fix #5: Store tool path in session state for later tracking in tool_result
    if (
      state &&
      toolPath &&
      (event.toolName === 'write' || event.toolName === 'read' || event.toolName === 'edit')
    ) {
      // Store in a temporary map for tool_result to access
      if (!state.pendingToolSpans.has(event.toolCallId)) {
        state.pendingToolSpans.set(event.toolCallId, Promise.resolve(null));
      }
      // Add path tracking to pendingToolSpans metadata
      (state.pendingToolSpans as any).toolPaths =
        (state.pendingToolSpans as any).toolPaths || new Map();
      (state.pendingToolSpans as any).toolPaths.set(event.toolCallId, {
        path: toolPath,
        toolName: event.toolName,
      });

      logger.info('tool_path_stored', {
        sessionKey,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        path: toolPath,
      });
    }

    logger.debug('tool_span_creation_complete', {
      sessionKey,
      toolCallId: event.toolCallId,
      schemaName,
    });
  });

  pi.on('tool_result', async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    const resultText = extractTextFromContent(event.content);
    const isError = event.isError ?? false;
    const endTime = Date.now();

    logger.debug('tool_result', {
      sessionKey,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      isError,
      resultTextPreview: resultText.slice(0, 100),
    });

    // P0 Critical Fix #5: Track file operations and activity in session state
    const state = sessionManager.getSessionState(sessionKey);
    if (state) {
      // Track tool call count
      state.toolCalls++;

      // P0 CRITICAL: Extract path from result text (args not available in tool_result!)
      const extractedPath = extractPathFromToolResult(resultText, event.toolName);

      // Also try direct args as backup
      const args = event.args as { path?: string } | undefined;
      const directPath = args?.path;

      // Use extracted path from result text, fallback to direct path
      const path = extractedPath || directPath;

      logger.info('tool_result_state_tracking', {
        sessionKey,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        path,
        extractedPath,
        directPath,
        isError,
        hasState: true,
        hasExtractedPath: !!extractedPath,
        hasDirectPath: !!directPath,
      });

      // Track file modifications
      if ((event.toolName === 'write' || event.toolName === 'edit') && path) {
        if (!isError) {
          state.filesModified.add(path);
          logger.info('file_modified_tracked', {
            sessionKey,
            path,
            toolName: event.toolName,
            filesModifiedCount: state.filesModified.size,
          });

          if (event.toolName === 'write' && (event as any).created) {
            state.filesCreated.push(path);
            logger.info('file_created_tracked', {
              sessionKey,
              path,
              filesCreatedCount: state.filesCreated.length,
            });
          }
        }
      }

      if (event.toolName === 'read' && path) {
        if (!isError) {
          state.filesRead.add(path);
          logger.info('file_read_tracked', {
            sessionKey,
            path,
            filesReadCount: state.filesRead.size,
          });
        }
      }

      if (event.toolName === 'bash') {
        state.commandsRun++;
        logger.info('command_tracked', {
          sessionKey,
          commandsRun: state.commandsRun,
        });
      }
    } else {
      logger.warn('tool_result_no_state', {
        sessionKey,
        toolName: event.toolName,
      });
    }

    // P0 Critical Fix #2: Build result payload based on tool type - ALWAYS capture outputs for auditing
    const resultPayload: Record<string, unknown> = {
      isError,
      endTime: endTime, // CRITICAL: Track end time for duration
    };

    // Capture tool outputs - critical for auditing even on errors
    if (event.toolName === 'bash') {
      // Debug: log what's in event.result
      logger.debug('tool_result_bash_debug', {
        sessionKey,
        hasResult: !!event.result,
        resultType: typeof event.result,
        resultKeys: event.result ? Object.keys(event.result) : [],
      });

      const result = event.result as
        | { exitCode?: number; stdout?: string; stderr?: string; durationMs?: number }
        | undefined;
      if (result) {
        resultPayload.exitCode = result.exitCode;
        resultPayload.stdout = result.stdout?.slice(0, config.maxOutputLength);
        resultPayload.stderr = result.stderr?.slice(0, config.maxOutputLength);
        resultPayload.durationMs = result.durationMs;
      }
      // If no result object, try to extract from content
      if (!result && resultText) {
        // Bash output is in the content, exit code may not be available
        resultPayload.stdout = resultText.slice(0, config.maxOutputLength);
      }
    } else if (event.toolName === 'read') {
      const result = event.result as
        | { content?: string; lineCount?: number; encoding?: string }
        | undefined;
      if (result) {
        resultPayload.contentLength = result.content?.length;
        resultPayload.lineCount = result.lineCount;
        resultPayload.encoding = result.encoding;
      }
    } else if (event.toolName === 'write') {
      const result = event.result as { success?: boolean; backupPath?: string } | undefined;
      if (result) {
        resultPayload.success = result.success;
        resultPayload.backupPath = result.backupPath;
      }
    } else if (event.toolName === 'edit') {
      const result = event.result as { successCount?: number; failedCount?: number } | undefined;
      if (result) {
        resultPayload.successCount = result.successCount;
        resultPayload.failedCount = result.failedCount;
      }
    }

    await sessionManager.closeToolCallSpanWithResult(
      sessionKey,
      event.toolCallId,
      event.toolName,
      resultText,
      isError,
      resultPayload
    );
  });

  // ==================== MESSAGE HOOKS ====================

  pi.on('message_start', async (event, ctx) => {
    logger.debug('message_start', {
      sessionKey: getSessionKey(ctx),
      role: event.message.role,
    });
  });

  pi.on('message_end', async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    const role = event.message.role;

    logger.debug('message_end', {
      sessionKey,
      role,
    });

    // P0 CRITICAL: Capture assistant response (assistant role messages)
    if (role === 'assistant') {
      const state = sessionManager.getSessionState(sessionKey);
      const parentSpanId = state?.agentRunSpanId || null;

      // Extract response text from message content
      const responseText = extractTextFromContent(event.message.content);
      
      // Try to extract thinking from structured properties first, then from content
      const structuredThinking = (event as any)?.thinking || (event as any)?.reasoning || '';
      const contentThinking = extractThinkingFromContent(event.message.content);
      const thinking = structuredThinking || contentThinking || '';

      logger.debug('message_end_assistant', {
        sessionKey,
        hasResponse: !!responseText,
        hasThinking: !!thinking,
        thinkingSource: structuredThinking ? 'structured' : contentThinking ? 'content' : 'none',
        parentSpanId,
      });

      // P0 Critical: Create pi:agent_thinking span if thinking content exists
      if (thinking && responseText) {
        const thinkingStartTime = Date.now();

        // Create agent_thinking span as child of agent_run
        await sessionManager.createAgentThinkingSpan(
          sessionKey,
          {
            thinking: thinking,
            model: (ctx.model as any)?.id,
          },
          parentSpanId
        );

        // Close thinking span immediately
        await sessionManager.closeAgentThinkingSpan(sessionKey, {
          durationMs: Date.now() - thinkingStartTime,
          isError: false,
        });

        logger.info('agent_thinking_captured', {
          sessionKey,
          thinkingSource: structuredThinking ? 'structured' : 'content',
          thinkingPreview: thinking.slice(0, 50),
        });
      }

      if (responseText) {
        const startTime = Date.now();

        // Create assistant_response span
        await sessionManager.createAssistantResponseSpan(
          sessionKey,
          {
            text: responseText,
            model: (ctx.model as any)?.id,
          },
          parentSpanId
        );

        // Close the span immediately
        await sessionManager.closeAssistantResponseSpan(sessionKey, {
          durationMs: Date.now() - startTime,
          isError: false,
        });

        logger.info('assistant_response_captured', {
          sessionKey,
          textPreview: responseText.slice(0, 50),
        });
      }
    }
  });

  // Register configuration command
  registerConfigCommand(pi, config);

  logger.info('extension_initialized', {
    hooks: 10, // After P0 cleanup: removed turn_start, turn_end, interaction span creation
    sessionTimeoutHours: config.sessionTimeoutHours,
    interactionTimeoutMinutes: config.userInteractionTimeoutMinutes,
  });
}

// Re-export types for documentation
export type { AgentConfig } from './agent.js';
export { createAgent } from './agent.js';
export type { LogLevel } from './logger.js';
export { createLogger } from './logger.js';
export type { PrefactorConfig } from './config.js';
export { loadConfig, validateConfig, getConfigSummary } from './config.js';
export { createSessionStateManager } from './session-state.js';
