/**
 * Pi Prefactor Extension - MVP
 * 
 * Instruments pi coding agent with Prefactor spans for distributed tracing.
 * 
 * @module
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import packageJson from '../../package.json' with { type: 'json' };
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
      
      const msg = `Prefactor Extension Configuration:\n\n` +
        `Status: ${validation.ok ? '✅ Valid' : '❌ Invalid'}\n\n` +
        (validation.ok 
          ? Object.entries(summary).map(([k, v]) => `- ${k}: ${v}`).join('\n')
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
  const agent = createAgent({
    apiUrl: config.apiUrl,
    apiToken: config.apiToken,
    agentId: config.agentId,
    agentName: config.agentName,
    agentVersion: config.agentVersion,
    piVersion: '0.66.0', // Pi version
    pluginVersion: packageJson.version || '0.0.1',
  }, logger);
  
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
  
  pi.on("session_start", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    logger.debug('session_start', { reason: event.reason, sessionKey });
    await sessionManager.createSessionSpan(sessionKey);
  });
  
  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    logger.debug('session_shutdown', { sessionKey });
    
    // P0 Critical Fix: Close agent_run span FIRST with comprehensive data before cleanup
    const state = sessionManager.getSessionState(sessionKey);
    const endTime = Date.now();
    
    if (state && state.agentRunSpanId) {
      logger.debug('session_shutdown_closing_agent_run', {
        sessionKey,
        hasState: true,
        filesModified: state.filesModified.size,
        toolCalls: state.toolCalls,
        commandsRun: state.commandsRun,
      });
      
      await sessionManager.closeAgentRunSpan(sessionKey, 'complete', {
        endTime,
        success: true,  // Session shutdown is normal completion
        filesModified: state.filesModified ? Array.from(state.filesModified) : [],
        filesRead: state.filesRead ? Array.from(state.filesRead) : [],
        filesCreated: state.filesCreated || [],
        commandsRun: state.commandsRun || 0,
        toolCalls: state.toolCalls || 0,
        reason: 'session_shutdown',
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
  
  pi.on("input", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    pendingUserMessage = { text: event.text, timestamp: Date.now() };
    
    logger.debug('input', {
      sessionKey,
      textPreview: event.text.slice(0, 50),
      source: event.source,
    });
    
    await sessionManager.createOrGetInteractionSpan(sessionKey);
    await sessionManager.createUserMessageSpan(sessionKey, pendingUserMessage);
    
    // Close the span immediately (message is complete once sent)
    await sessionManager.closeUserMessageSpan(sessionKey);
  });
  
  // ==================== AGENT HOOKS ====================
  
  pi.on("before_agent_start", async (event, ctx) => {
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
    
    // P0 Critical Fix #4: Capture agent run with comprehensive data for auditing
    const systemPromptHash = event.prompt ? createHash('sha256').update(event.prompt).digest('hex').slice(0, 16) : undefined;
    
    await sessionManager.createAgentRunSpan(sessionKey, {
      messageCount: event.messages?.length || 0,
      startTime: startTime,
      model: (ctx.model as any)?.id || 'unknown',
      provider: (ctx.model as any)?.provider || 'unknown',
      temperature: (ctx.model as any)?.temperature,
      systemPromptHash: systemPromptHash,
    });
    
    // Track start time in session state for duration calculation
    const state = sessionManager.getSessionState(sessionKey);
    if (state) {
      (state as any).agentRunStartTime = startTime;
    }
  });
  
  pi.on("agent_end", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    const endTime = Date.now();
    
    logger.info('agent_end', {
      sessionKey,
      success: event.success,
      messageCount: event.messages?.length,
    });
    
    // P0 Critical Fix #4: Get session state for comprehensive agent run payload
    const state = sessionManager.getSessionState(sessionKey);
    
    // P0 Critical Fix #3, #4: Close agent run span with duration and comprehensive data
    // Only close if agent_run span still exists (session_shutdown may have already closed it)
    if (state && state.agentRunSpanId) {
      await sessionManager.closeAgentRunSpan(sessionKey, 'complete', {
        endTime,
        success: event.success ?? true,
        filesModified: state?.filesModified ? Array.from(state.filesModified) : [],
        filesRead: state?.filesRead ? Array.from(state.filesRead) : [],
        filesCreated: state?.filesCreated || [],
        commandsRun: state?.commandsRun || 0,
        toolCalls: state?.toolCalls || 0,
        reason: event.success ? 'completed' : 'failed',
      });
      logger.info('agent_run_span_closed', { sessionKey });
    } else {
      logger.debug('agent_run_span_already_closed', { sessionKey });
    }
  });
  
  // ==================== TURN HOOKS ====================
  
  pi.on("turn_start", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    if (!sessionKey) {
      logger.debug('turn_start_no_session', { sessionId: ctx.sessionId });
      return;
    }
    
    logger.info('turn_start', { 
      sessionKey, 
      turnIndex: event.turnIndex,
    });
    
    const spanId = await sessionManager.createTurnSpan(sessionKey, event.turnIndex, {
      turnIndex: event.turnIndex,
      model: ctx.model?.id,
    });
    
    logger.info('turn_span_created', {
      sessionKey,
      turnIndex: event.turnIndex,
      spanId,
    });
  });
  
  pi.on("turn_end", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    
    // Debug: Log what's in the event
    logger.debug('turn_end_debug', {
      sessionKey,
      hasMessage: !!event.message,
      hasThinking: !!(event.message?.thinking),
      thinkingType: typeof event.message?.thinking,
      thinkingPreview: typeof event.message?.thinking === 'string' ? event.message.thinking.slice(0, 100) : 'N/A',
      contentPreview: event.message?.content ? (Array.isArray(event.message.content) ? 'array' : typeof event.message.content) : 'N/A',
    });
    
    // Capture thinking - try structured first, then extract from content
    let thinking = '';
    
    // Try structured thinking field (some models support this)
    if (event.message?.thinking && typeof event.message.thinking === 'string') {
      thinking = event.message.thinking;
    } else if (config.captureThinking) {
      // Fallback: Extract thinking from content for models that output thinking as text
      const content = event.message?.content;
      if (Array.isArray(content)) {
        const textBlocks = content
          .filter(block => block?.type === 'text')
          .map(block => block.text)
          .join('\n');
        
        // Look for thinking patterns (common in reasoning models)
        // Pattern 1: "Let me think/work through..." up to final answer
        // Pattern 2: Numbered steps before final answer
        const thinkingPatterns = [
          /^(Let me (think|work) through[\s\S]*?)(?=\n\n\*\*|## |$)/i,
          /^(Let me [\s\S]*?)(?=\n\n\*\*|## Answer|$)/i,
          /^(Step \d+:[\s\S]*?)(?=\n\n\*\*|## |Final Answer|$)/i,
        ];
        
        for (const pattern of thinkingPatterns) {
          const match = textBlocks.match(pattern);
          if (match && match[1].trim()) {
            thinking = match[1].trim();
            logger.debug('thinking_extracted_from_content', {
              sessionKey,
              thinkingLength: thinking.length,
              pattern: pattern.toString(),
            });
            break;
          }
        }
      }
    }
    
    if (thinking && config.captureThinking) {
      await sessionManager.createAgentThinkingSpan(
        sessionKey,
        thinking,
        event.usage ? {
          input: event.usage.inputTokens,
          output: event.usage.outputTokens,
        } : undefined,
        {
          provider: (ctx.model as any)?.provider,
          model: (ctx.model as any)?.id,
        }
      );
      // Close immediately (thinking is complete once captured)
      await sessionManager.closeAgentThinkingSpan(sessionKey);
    }
    
    // Capture assistant response
    const text = extractTextFromContent(event.message?.content);
    if (text) {
      await sessionManager.createAssistantResponseSpan(
        sessionKey,
        text,
        event.usage ? {
          input: event.usage.inputTokens,
          output: event.usage.outputTokens,
        } : undefined,
        {
          provider: (ctx.model as any)?.provider,
          model: (ctx.model as any)?.id,
        }
      );
      // Close the span immediately (response is complete once delivered)
      await sessionManager.closeAssistantResponseSpan(sessionKey);
    }
    
    logger.info('turn_end', {
      sessionKey,
      turnIndex: event.turnIndex,
      toolResultsCount: event.toolResults?.length,
    });
    
    // Close turn span (may already be closed by session_shutdown cleanup)
    logger.debug('closing_turn_span', {
      sessionKey,
      turnIndex: event.turnIndex,
    });
    try {
      await sessionManager.closeTurnSpan(sessionKey, event.turnIndex, {
        turnIndex: event.turnIndex,
        success: event.success,
      });
      logger.debug('turn_span_closed', {
        sessionKey,
        turnIndex: event.turnIndex,
      });
    } catch (err) {
      // Span may have already been closed by session_shutdown
      logger.debug('turn_span_already_closed', {
        sessionKey,
        turnIndex: event.turnIndex,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  
  // ==================== TOOL HOOKS ====================
  
  pi.on("tool_execution_start", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    const startTime = Date.now();
    
    logger.debug('tool_execution_start', {
      sessionKey,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
    });
    
    // P0 Critical Fix #1: Determine schema name based on tool name - use SPECIFIC tool types
    let schemaName: 'pi:tool:bash' | 'pi:tool:read' | 'pi:tool:write' | 'pi:tool:edit' | 'pi:tool_call' = 'pi:tool_call';
    
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
      startTime: startTime,  // CRITICAL: Track start time for duration
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
        payload.created = (event as any).created;  // If available
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
    if (state && toolPath && (event.toolName === 'write' || event.toolName === 'read' || event.toolName === 'edit')) {
      // Store in a temporary map for tool_result to access
      if (!state.pendingToolSpans.has(event.toolCallId)) {
        state.pendingToolSpans.set(event.toolCallId, Promise.resolve(null));
      }
      // Add path tracking to pendingToolSpans metadata
      (state.pendingToolSpans as any).toolPaths = (state.pendingToolSpans as any).toolPaths || new Map();
      (state.pendingToolSpans as any).toolPaths.set(event.toolCallId, { path: toolPath, toolName: event.toolName });
      
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
  
  pi.on("tool_result", async (event, ctx) => {
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
      endTime: endTime,  // CRITICAL: Track end time for duration
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
      
      const result = event.result as { exitCode?: number; stdout?: string; stderr?: string; durationMs?: number } | undefined;
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
      const result = event.result as { content?: string; lineCount?: number; encoding?: string } | undefined;
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
  
  pi.on("message_start", async (event, ctx) => {
    logger.debug('message_start', {
      sessionKey: getSessionKey(ctx),
      role: event.message.role,
    });
  });
  
  pi.on("message_end", async (event, ctx) => {
    logger.debug('message_end', {
      sessionKey: getSessionKey(ctx),
      role: event.message.role,
    });
  });
  
  // Register configuration command
  registerConfigCommand(pi, config);
  
  logger.info('extension_initialized', {
    hooks: 15,  // Added turn_start, turn_end (was: 13)
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
