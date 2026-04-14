/**
 * pi-prefactor-ext: Prefactor instrumentation for pi coding agent
 *
 * This extension integrates with the pi coding agent to capture traces
 * from ai coding agent operations.
 *
 * @module
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { SpanSchemaName, AnySpanPayload, AnySpanResult } from './schemas.js';
import type { FileOperation } from './file-tracker.js';
import { createHash } from 'node:crypto';
import { getConfigSummary, getMissingCredentials, loadConfig, validateConfig } from './config.js';
import { getLogger } from './logger.js';
import { createPrefactorClient } from './prefactor-client.js';
import { createSpanManager } from './span-manager.js';
import { createSessionTracker } from './session-tracker.js';
import { createFileTracker } from './file-tracker.js';

// Export types and interfaces
export type { Config } from './config.js';
export type { Logger, LogLevel } from './logger.js';
export type { PrefactorClient, PrefactorClientConfig } from './prefactor-client.js';
export type { SpanManager, SpanManagerImpl } from './span-manager.js';
export type { SessionTracker, SessionTrackerImpl } from './session-tracker.js';
export type { FileTracker, FileOperation } from './file-tracker.js';
export type {
  SessionPayload,
  SessionResult,
  UserMessagePayload,
  UserMessageResult,
  AgentRunPayload,
  AgentRunResult,
  ToolCallPayload,
  ToolCallResult,
  BashToolPayload,
  BashToolResult,
  ReadToolPayload,
  ReadToolResult,
  WriteToolPayload,
  WriteToolResult,
  EditToolPayload,
  EditToolResult,
  AssistantResponsePayload,
  AssistantResponseResult,
  AssistantThinkingPayload,
  AssistantThinkingResult,
  AnySpanPayload,
  AnySpanResult,
  SpanSchemaName,
  SpanSchemaMetadata,
} from './schemas.js';

// Export factory functions
export { createPrefactorClient } from './prefactor-client.js';
export { createSpanManager } from './span-manager.js';
export { createSessionTracker } from './session-tracker.js';
export { createFileTracker } from './file-tracker.js';

// Export config and logger
export { loadConfig, validateConfig, getConfigSummary } from './config.js';
export { getLogger } from './logger.js';

// Export schemas
export * from './schemas.js';

/**
 * Extract text from message content (type: "text" blocks only).
 * Thinking content is extracted separately by extractThinkingFromContent().
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
 * Extract thinking content from an AssistantMessage's content array.
 *
 * Follows the same pattern as pi-coding-agent's compaction/utils.js
 * and providers/transform-messages.js: iterate content[] checking for
 * block.type === "thinking" and read block.thinking for the text.
 *
 * Skips redacted blocks (Anthropic safety filter) and empty thinking.
 * Joins multiple thinking blocks with double newline separator.
 *
 * @param content - The message content array or string
 * @returns Thinking text if found, undefined otherwise
 */
function extractThinkingFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return undefined;
  if (!Array.isArray(content)) return undefined;

  const thinkingParts: string[] = [];
  for (const block of content) {
    if (block?.type === 'thinking' && typeof block.thinking === 'string') {
      // Skip redacted blocks — they contain "[Reasoning redacted]", not actual thinking
      if (block.redacted) continue;
      // Skip empty thinking blocks
      if (!block.thinking.trim()) continue;
      thinkingParts.push(block.thinking);
    }
  }

  return thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined;
}

/**
 * Extract file path from tool result content
 */
function extractPathFromToolResult(resultText: string, toolName: string): string | undefined {
  if (!resultText) return undefined;

  if (toolName === 'write') {
    const writeMatch = resultText.match(/to\s+([\/\w\-.]+\.[\w-]+)/i);
    if (writeMatch && writeMatch[1]) {
      return writeMatch[1];
    }
  } else if (toolName === 'read') {
    const readMatch = resultText.match(/(?:from|File:)\s+([\/\w\-.]+\.[\w-]+)/i);
    if (readMatch && readMatch[1]) {
      return readMatch[1];
    }
  } else if (toolName === 'edit') {
    const editMatch = resultText.match(/(?:Edited|Modified)\s+([\/\w\-.]+\.[\w-]+)/i);
    if (editMatch && editMatch[1]) {
      return editMatch[1];
    }
  }

  return undefined;
}

/**
 * Extension entry point
 *
 * @param api - Extension API provided by pi
 */
export default function extension(api: ExtensionAPI): void {
  // Load configuration — never throws, returns isConfigured: false when
  // credentials are missing so the extension degrades gracefully.
  const config = loadConfig();
  const logger = getLogger('extension', config);

  // Runtime toggle for tracing. Starts as true when credentials are present,
  // false when they're missing. Can be toggled with /prefactor-enable and
  // /prefactor-disable commands regardless of initial state.
  let tracingEnabled = config.isConfigured;

  const missing = getMissingCredentials(config);
  const missingList = missing.join(', ');

  // ==================== COMMANDS ====================

  api.registerCommand('prefactor-enable', {
    description: 'Enable Prefactor telemetry tracing',
    handler: async (_args, ctx) => {
      if (!config.isConfigured) {
        ctx.ui.notify(
          `Cannot enable Prefactor — missing credentials: ${missingList}. Set these environment variables and restart pi.`,
          'error',
        );
        return;
      }
      if (tracingEnabled) {
        ctx.ui.notify('Prefactor tracing is already enabled.', 'info');
        return;
      }
      tracingEnabled = true;
      if (ctx.hasUI) {
        ctx.ui.setStatus('prefactor', ctx.ui.theme.fg('dim', 'Prefactor (active)'));
        ctx.ui.notify('Prefactor tracing enabled.', 'info');
      }
      logger.info('tracing_enabled_by_command');
    },
  });

  api.registerCommand('prefactor-disable', {
    description: 'Disable Prefactor telemetry tracing',
    handler: async (_args, ctx) => {
      if (!tracingEnabled) {
        ctx.ui.notify('Prefactor tracing is already disabled.', 'info');
        return;
      }
      tracingEnabled = false;
      if (ctx.hasUI) {
        ctx.ui.setStatus('prefactor', ctx.ui.theme.fg('dim', 'Prefactor (inactive)'));
        ctx.ui.notify('Prefactor tracing disabled. Spans in flight will finish, but no new spans will be created.', 'info');
      }
      logger.info('tracing_disabled_by_command');
    },
  });

  // ==================== TRACKERS & CLIENTS ====================

  // Only create the Prefactor client and span manager when credentials are present.
  // When not configured, all telemetry hooks early-return and these are never used.
  const client = config.isConfigured ? createPrefactorClient(config, logger) : (undefined as any);
  const spanManager = config.isConfigured ? createSpanManager(client, logger) : (undefined as any);
  const sessionTracker = createSessionTracker(logger);
  const fileTracker = createFileTracker(logger);

  // Track pending tool results
  const pendingToolResults = new Map<string, { resultText: string; isError: boolean; path?: string }>();

  // Map toolCallId → spanId so tool_execution_end can finish the span
  const toolCallSpanMap = new Map<string, string>();

  // Track user_message span ID so it can be finished at agent_start
  let userMessageSpanId: string | null = null;

  // Track assistant response span per message
  let assistantResponseSpanId: string | null = null;

  // Track whether session has been shut down (late events may arrive after shutdown)
  let sessionShuttingDown = false;

  // Track tool call count for the current agent run
  let toolCallCount = 0;

  // ==================== SESSION HOOKS ====================

  api.on('session_start', async (event, ctx) => {
    if (ctx.hasUI) {
      const status = tracingEnabled
        ? ctx.ui.theme.fg('dim', 'Prefactor (active)')
        : ctx.ui.theme.fg('dim', 'Prefactor (inactive)');
      ctx.ui.setStatus('prefactor', status);
    }

    // When not configured, show a one-time warning and skip telemetry
    if (!config.isConfigured) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Prefactor inactive — set ${missingList} to enable.`,
          'warning',
        );
      }
      logger.info('session_start_unconfigured', { missing });
      return;
    }

    // When configured but tracing disabled, skip telemetry setup
    if (!tracingEnabled) {
      logger.info('session_start_tracing_disabled');
      // Still track session locally so re-enabling mid-session can work
      const sessionId = `session-${Date.now()}`;
      sessionTracker.startSession(sessionId);
      fileTracker.reset();
      return;
    }

    const sessionId = `session-${Date.now()}`;
    logger.info('session_started', { sessionId, reason: event.reason });

    try {
      // Start new session tracking
      sessionTracker.startSession(sessionId);

      // Create Prefactor instance
      const instance = await client.createInstance();
      if (instance?.instanceId) {
        sessionTracker.startInstance(instance.instanceId);
        spanManager.setInstanceId(instance.instanceId);

        // Create session span
        const sessionSpanId = await spanManager.createSpan('pi:session', {
          createdAt: new Date().toISOString(),
        });

        // Store session span ID for child spans
        if (sessionSpanId) {
          sessionTracker.setSessionSpanId(sessionSpanId);
        }

        logger.debug('session_span_created', { sessionId, sessionSpanId });
      }

      // Reset file tracker for new session
      fileTracker.reset();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('session_start_error', { error });
    }
  });

  api.on('session_shutdown', async (event, ctx) => {
    const sessionId = sessionTracker.getSessionId();
    const hasAgentRun = !!sessionTracker.getAgentRunSpanId();
    logger.info('session_shutdown', { sessionId, hasAgentRun });

    sessionShuttingDown = true;

    try {
      // Clear the footer status indicator
      if (ctx.hasUI) {
        ctx.ui.setStatus('prefactor', undefined);
      }

      // If the agent never started (no agent_run span), there are no spans
      // to wait for — clean up the instance now.
      // Otherwise, agent_end will handle cleanup (even if it hasn't fired yet).
      if (!hasAgentRun && tracingEnabled) {
        await spanManager.finishAllSpans('complete');

        const instanceId = sessionTracker.getInstanceId();
        if (instanceId) {
          await client.finishInstance(instanceId, 'complete');
          logger.info('instance_finished_no_agent', { instanceId });
        }

        // Log session end
        const startTime = sessionTracker.getStartTime();
        const endTime = Date.now();
        logger.info('session_ended', {
          sessionId,
          startTime,
          endTime,
          duration: startTime ? endTime - startTime : null,
        });

        // Reset state
        fileTracker.reset();
        sessionTracker.endSession();
        assistantResponseSpanId = null;
        userMessageSpanId = null;
        toolCallSpanMap.clear();
        toolCallCount = 0;
      }
      // If the agent DID start, agent_end will handle the cleanup when it fires.
      // In interactive mode, agent_end fires before session_shutdown.
      // In print mode, agent_end may fire after session_shutdown but it still works
      // because the spans and session state are intact.
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('session_shutdown_error', { error });
    }
  });

  // ==================== INPUT HOOK ====================

  api.on('input', async (event, ctx) => {
    if (!tracingEnabled) return;

    const sessionId = sessionTracker.getSessionId();
    if (!sessionId) {
      logger.warn('input_no_session', { textPreview: event.text.slice(0, 50) });
      return;
    }

    logger.debug('input', {
      sessionId,
      textPreview: event.text.slice(0, 50),
      source: event.source,
    });

    try {
      // Store user request in session tracker
      sessionTracker.setUserRequest(event.text);

      // Create user_message span with session as parent
      const sessionSpanId = sessionTracker.getSessionSpanId();
      const createdSpanId = await spanManager.createSpan(
        'pi:user_message',
        {
          text: event.text,
          timestamp: new Date().toISOString(),
        },
        sessionSpanId || undefined
      );

      if (createdSpanId) {
        userMessageSpanId = createdSpanId;
      }

      logger.debug('user_message_span_created', { sessionId });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('input_error', { error });
    }
  });

  /**
   * Perform final cleanup after the agent has finished.
   * Called by agent_end when it detects session_shutdown already ran (print mode).
   * Finishes all remaining spans, attempts to finish the instance (409 is fine),
   * and resets local state.
   */
  async function performFinalCleanup(): Promise<void> {
    try {
      // Finish any remaining active spans (from late events)
      await spanManager.finishAllSpans('complete');

      // Finish Prefactor instance (may 409 if session_shutdown already finished it — that's fine)
      const instanceId = sessionTracker.getInstanceId();
      if (instanceId) {
        try {
          await client.finishInstance(instanceId, 'complete');
          logger.info('instance_finished_late', { instanceId });
        } catch {
          // 409 expected if already finished by session_shutdown
        }
      }

      // Reset state
      fileTracker.reset();
      sessionTracker.endSession();
      assistantResponseSpanId = null;
      userMessageSpanId = null;
      toolCallSpanMap.clear();
      toolCallCount = 0;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('final_cleanup_error', { error });
    }
  }

  // ==================== AGENT HOOKS ====================

  api.on('agent_start', async (event, ctx) => {
    if (!tracingEnabled) return;

    const sessionId = sessionTracker.getSessionId();
    if (!sessionId) {
      logger.warn('agent_start_no_session');
      return;
    }

    const agentRunStartTime = Date.now();

    logger.debug('agent_start', {
      sessionId,
    });

    try {
      // Finish user_message span now that we're entering the agent run
      if (userMessageSpanId) {
        await spanManager.finishSpan(userMessageSpanId, {
          text: sessionTracker.getUserRequest() || '',
          acknowledged: true,
          isError: false,
          durationMs: Date.now() - ((spanManager as any).getSpan(userMessageSpanId)?.startTime || Date.now()),
        } as any);
        logger.debug('user_message_span_finished', { sessionId, userMessageSpanId });
        userMessageSpanId = null;
      }

      // Get model info from context
      const model = (ctx.model as any)?.id || 'unknown';
      const temperature = (ctx.model as any)?.temperature;

      // Get system prompt via ctx.getSystemPrompt()
      const systemPrompt = ctx.getSystemPrompt?.() || '';
      const maxSystemPromptLength = 2000;
      const systemPromptHash = systemPrompt
        ? createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16)
        : undefined;

      // Get thinking level from Pi
      const thinkingLevel = (ctx as any).thinkingLevel || 'none';

      // Get available tools
      const toolsAvailable: string[] = [];

      // Get skills loaded
      const skillsLoaded: string[] = [];

      // Get user request from session tracker
      const userRequest = sessionTracker.getUserRequest() || '';

      // Create agent_run span with session as parent
      const sessionSpanId = sessionTracker.getSessionSpanId();
      const agentRunSpanId = await spanManager.createSpan(
        'pi:agent_run',
        {
          model,
          temperature,
          systemPrompt: systemPrompt.slice(0, maxSystemPromptLength),
          systemPromptHash,
          systemPromptLength: systemPrompt.length,
          skillsLoaded,
          toolsAvailable,
          userRequest,
          thinkingLevel,
        } as any,
        sessionSpanId || undefined
      );

      if (agentRunSpanId) {
        sessionTracker.setAgentRunSpan(agentRunSpanId);
        sessionTracker.setAgentRunStartTime(agentRunStartTime);
        toolCallCount = 0; // Reset for new agent run
        logger.debug('agent_run_span_created', { sessionId, agentRunSpanId });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('agent_start_error', { error });
    }
  });

  api.on('agent_end', async (event, ctx) => {
    if (!tracingEnabled) return;

    const sessionId = sessionTracker.getSessionId();
    const agentRunSpanId = sessionTracker.getAgentRunSpanId();
    const endTime = Date.now();

    logger.info('agent_end', {
      sessionId,
      agentRunSpanId,
      messageCount: event.messages.length,
      sessionShuttingDown,
    });

    try {
      if (!agentRunSpanId) {
        logger.warn('agent_end_no_agent_run_span');
        return;
      }

      // Check if the span is still active (may have been finished by session_shutdown)
      const spanInfo = (spanManager as any).getSpan(agentRunSpanId);
      if (!spanInfo) {
        logger.info('agent_end_span_already_finished', { agentRunSpanId });
        // Span already finished by session_shutdown. But we may still need to
        // finish remaining spans and the instance if session_shutdown deferred that.
        if (sessionShuttingDown) {
          await performFinalCleanup();
        }
        return;
      }

      // Calculate duration from start time
      const startTime = sessionTracker.getAgentRunStartTime() || endTime;
      const durationMs = endTime - startTime;

      // Get files modified from file tracker
      const filesModified = fileTracker.getAllPaths();
      const filesCreated = fileTracker.getFilesCreated();
      const filesRead: string[] = []; // Track if needed

      // AgentEndEvent only has messages — infer completion status
      const terminationReason: 'completed' | 'error' | 'user_cancel' | 'timeout' | 'session_shutdown' = 'completed';

      // Token usage is not available on AgentEndEvent
      const tokens: { input: number; output: number; total: number } | undefined = undefined;

      // Finish agent_run span with comprehensive result payload
      await spanManager.finishSpan(
        agentRunSpanId,
        {
          success: true,
          terminationReason,
          tokens,
          filesModified,
          filesCreated,
          filesRead,
          commandsRun: 0,
          toolCalls: toolCallCount,
          durationMs,
        } as any,
        durationMs
      );

      logger.info('agent_run_span_finished', {
        sessionId,
        agentRunSpanId,
        durationMs,
        toolCallCount,
        filesModifiedCount: filesModified.length,
      });

      // If session is shutting down, perform final cleanup (finish remaining
      // spans + instance). session_shutdown defers this to us when the agent
      // started after shutdown (common in print mode).
      if (sessionShuttingDown) {
        await performFinalCleanup();
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('agent_end_error', { error });
    }
  });

  // ==================== TOOL HOOKS ====================

  api.on('tool_execution_start', async (event, ctx) => {
    if (!tracingEnabled) return;

    const sessionId = sessionTracker.getSessionId();
    const agentRunSpanId = sessionTracker.getAgentRunSpanId();

    logger.debug('tool_execution_start', {
      sessionId,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
    });

    try {
      if (!agentRunSpanId) {
        logger.warn('tool_execution_start_no_agent_run_span');
        return;
      }

      // Determine schema name based on tool name
      let schemaName: SpanSchemaName = 'pi:tool_call';

      if (event.toolName === 'bash') {
        schemaName = 'pi:tool:bash';
      } else if (event.toolName === 'read') {
        schemaName = 'pi:tool:read';
      } else if (event.toolName === 'write') {
        schemaName = 'pi:tool:write';
      } else if (event.toolName === 'edit') {
        schemaName = 'pi:tool:edit';
      }

      // Build tool-specific payload
      const payload: Record<string, unknown> = {
        toolCallId: event.toolCallId,
        startTime: new Date().toISOString(),
      };

      if (event.toolName === 'bash') {
        const args = event.args as { command?: string; timeout?: number; cwd?: string };
        payload.command = args.command;
        payload.timeout = args.timeout;
        payload.cwd = args.cwd || process.cwd();
      } else if (event.toolName === 'read') {
        const args = event.args as { path?: string; offset?: number; limit?: number };
        payload.path = args.path;
        payload.offset = args.offset;
        payload.limit = args.limit;
      } else if (event.toolName === 'write') {
        const args = event.args as { path?: string; content?: string };
        payload.path = args.path;
        payload.contentLength = args.content?.length;
        payload.operation = 'create'; // Will be updated in tool_result if needed
      } else if (event.toolName === 'edit') {
        const args = event.args as { path?: string; edits?: any[] };
        payload.path = args.path;
        payload.editCount = args.edits?.length;
      }

      // Create tool span with agent_run as parent
      // Increment count synchronously (before async createSpan) to avoid race
      toolCallCount++;
      const toolSpanId = await spanManager.createSpan(schemaName, payload as any, agentRunSpanId);
      if (!toolSpanId) {
        // Span creation failed — roll back the count
        toolCallCount--;
      } else {
        toolCallSpanMap.set(event.toolCallId, toolSpanId);
      }

      logger.debug('tool_span_created', {
        sessionId,
        toolCallId: event.toolCallId,
        schemaName,
        toolSpanId,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('tool_execution_start_error', { error });
    }
  });

  api.on('tool_result', async (event, ctx) => {
    // File tracking runs even when tracing is disabled
    const sessionId = sessionTracker.getSessionId();
    const resultText = extractTextFromContent(event.content);
    const isError = event.isError ?? false;

    logger.debug('tool_result', {
      sessionId,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      isError,
      resultTextPreview: resultText.slice(0, 100),
    });

    try {
      // Extract path from result text
      const extractedPath = extractPathFromToolResult(resultText, event.toolName);
      const args = event.input as { path?: string } | undefined;
      const path = extractedPath || args?.path;

      // Track file modifications for write/edit (always, regardless of tracing)
      if ((event.toolName === 'write' || event.toolName === 'edit') && path && !isError) {
        // Determine if create or update
        const operation: FileOperation =
          event.toolName === 'write' && (event as any).created ? 'create' : 'update';
        fileTracker.trackFileModified(path, operation);

        logger.info('file_modified_tracked', {
          sessionId,
          path,
          operation,
          toolName: event.toolName,
        });
      }

      if (!tracingEnabled) return;

      // Store result for tool_execution_end
      pendingToolResults.set(event.toolCallId, {
        resultText,
        isError,
        path,
      });

      logger.debug('tool_result_stored', {
        sessionId,
        toolCallId: event.toolCallId,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('tool_result_error', { error });
    }
  });

  api.on('tool_execution_end', async (event, ctx) => {
    if (!tracingEnabled) return;

    const sessionId = sessionTracker.getSessionId();
    const endTime = Date.now();

    logger.debug('tool_execution_end', {
      sessionId,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
    });

    try {
      // Get stored result
      const storedResult = pendingToolResults.get(event.toolCallId);
      if (!storedResult) {
        logger.warn('tool_execution_end_no_result', {
          sessionId,
          toolCallId: event.toolCallId,
        });
        return;
      }

      // Build result payload based on tool type
      const resultPayload: Record<string, unknown> = {
        output: storedResult.resultText,
        isError: storedResult.isError,
        endTime,
      };

      if (event.toolName === 'bash') {
        const result = event.result as { exitCode?: number; stdout?: string; stderr?: string } | undefined;
        if (result) {
          resultPayload.exitCode = result.exitCode;
          resultPayload.stdout = result.stdout;
          resultPayload.stderr = result.stderr;
        }
      } else if (event.toolName === 'read') {
        const result = event.result as { contentLength?: number; lineCount?: number } | undefined;
        if (result) {
          resultPayload.contentLength = result.contentLength;
          resultPayload.lineCount = result.lineCount;
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

      // Calculate duration from the tool span's start time
      const toolSpanId = toolCallSpanMap.get(event.toolCallId);
      const toolSpan = toolSpanId ? (spanManager as any).getSpan(toolSpanId) : undefined;
      const toolStartTime: number = toolSpan?.startTime || endTime;
      const durationMs = endTime - toolStartTime;
      resultPayload.durationMs = durationMs;

      // Finish the tool span via the Prefactor API
      if (toolSpanId) {
        await spanManager.finishSpan(toolSpanId, resultPayload as any, durationMs);
        toolCallSpanMap.delete(event.toolCallId);
        logger.debug('tool_span_finished', {
          sessionId,
          toolCallId: event.toolCallId,
          toolSpanId,
          durationMs,
          isError: storedResult.isError,
        });
      } else {
        logger.warn('tool_execution_end_no_span_id', {
          sessionId,
          toolCallId: event.toolCallId,
        });
      }

      // Clean up pending result
      pendingToolResults.delete(event.toolCallId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('tool_execution_end_error', { error });
    }
  });

  // ==================== MESSAGE HOOKS ====================

  api.on('message_start', async (event, ctx) => {
    if (!tracingEnabled) return;

    const sessionId = sessionTracker.getSessionId();
    const agentRunSpanId = sessionTracker.getAgentRunSpanId();
    const role = event.message.role;

    logger.debug('message_start', {
      sessionId,
      role,
    });

    try {
      if (role === 'assistant' && agentRunSpanId) {
        // Reset per-message state for new assistant message
        sessionTracker.setThinkingSpanId(null);
        sessionTracker.setThinkingStartTime(null);
        // Don't create assistant_response span here — it will be created
        // on text_start / first text_delta so it appears AFTER the
        // assistant_thinking span in the timeline.
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('message_start_error', { error });
    }
  });

  api.on('message_update', async (event, ctx) => {
    if (!tracingEnabled) return;

    const sessionId = sessionTracker.getSessionId();
    const role = event.message.role;
    const assistantEvent = event.assistantMessageEvent;

    logger.debug('message_update', {
      sessionId,
      role,
      eventType: assistantEvent?.type,
    });

    try {
      if (role === 'assistant' && assistantEvent) {
        // Create thinking span on thinking_start for accurate timing
        if (assistantEvent.type === 'thinking_start') {
          const agentRunSpanId = sessionTracker.getAgentRunSpanId();
          const existingThinkingSpanId = sessionTracker.getThinkingSpanId();

          if (agentRunSpanId && !existingThinkingSpanId) {
            const thinkingSpanId = await spanManager.createSpan(
              'pi:assistant_thinking',
              {
                model: (ctx.model as any)?.id,
                startTime: new Date().toISOString(),
              } as any,
              agentRunSpanId
            );

            if (thinkingSpanId) {
              sessionTracker.setThinkingSpanId(thinkingSpanId);
              sessionTracker.setThinkingStartTime(Date.now());
              logger.debug('assistant_thinking_span_created_on_start', {
                sessionId,
                thinkingSpanId,
              });
            }
          }
        }

        // Create assistant_response span on first text_delta (not text_start).
        // Waiting for actual content avoids creating an empty span for tool-call-only
        // responses where the model emits text_start with no content.
        if (assistantEvent.type === 'text_delta'
            && !assistantResponseSpanId) {
          const agentRunSpanId = sessionTracker.getAgentRunSpanId();

          if (agentRunSpanId) {
            const responseSpanId = await spanManager.createSpan(
              'pi:assistant_response',
              {
                model: (ctx.model as any)?.id,
                startTime: new Date().toISOString(),
              } as any,
              agentRunSpanId
            );

            assistantResponseSpanId = responseSpanId;
            logger.debug('assistant_response_span_created', { sessionId, responseSpanId });
          }
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message ? String(err) : String(err) : String(err);
      logger.error('message_update_error', { error });
    }
  });

  api.on('message_end', async (event, ctx) => {
    if (!tracingEnabled) return;

    const sessionId = sessionTracker.getSessionId();
    const role = event.message.role;
    const endTime = Date.now();

    logger.debug('message_end', {
      sessionId,
      role,
    });

    try {
      if (role === 'assistant') {
        const agentRunSpanId = sessionTracker.getAgentRunSpanId();

        // Extract response text from message content (type: "text" blocks)
        const responseText = extractTextFromContent(event.message.content);

        // Extract thinking from message content (type: "thinking" blocks)
        // This is the canonical extraction - structured data, not regex
        const thinking = extractThinkingFromContent(event.message.content);

        logger.debug('message_end_assistant', {
          sessionId,
          hasResponse: !!responseText,
          hasThinking: !!thinking,
          thinkingLength: thinking?.length,
        });

        // Finish thinking span if one was created during streaming
        const thinkingSpanId = sessionTracker.getThinkingSpanId();
        if (thinkingSpanId) {
          const thinkingStartTime = sessionTracker.getThinkingStartTime();
          const durationMs = thinkingStartTime ? endTime - thinkingStartTime : 0;
          const thinkingResult = {
            thinking: thinking || '',
            durationMs,
            isError: false,
          };

          // Set pending result BEFORE async finish (guards against finishAllSpans race)
          spanManager.setPendingResult(thinkingSpanId, thinkingResult);
          await spanManager.finishSpan(thinkingSpanId, thinkingResult, durationMs);

          logger.debug('assistant_thinking_span_finished', {
            sessionId,
            thinkingSpanId,
            durationMs,
          });

          sessionTracker.setThinkingSpanId(null);
          sessionTracker.setThinkingStartTime(null);
        } else if (thinking) {
          // No streaming span was created, but we have thinking from message_end
          // Create and immediately finish a thinking span
          if (agentRunSpanId) {
            const newThinkingSpanId = await spanManager.createSpan(
              'pi:assistant_thinking',
              {
                model: (ctx.model as any)?.id,
                startTime: new Date().toISOString(),
              },
              agentRunSpanId
            );

            if (newThinkingSpanId) {
              await spanManager.finishSpan(newThinkingSpanId, {
                thinking,
                durationMs: 0,
                isError: false,
              });
              logger.debug('assistant_thinking_span_created_retroactive', {
                sessionId,
                thinkingSpanId: newThinkingSpanId,
              });
            }
          }
        }

        // Create assistant_response span if the model produced text.
        // Tool-call-only responses (no text) are represented by their tool spans —
        // creating an empty assistant_response would be misleading.
        if (!assistantResponseSpanId && responseText && agentRunSpanId) {
          const responseSpanId = await spanManager.createSpan(
            'pi:assistant_response',
            {
              model: (ctx.model as any)?.id,
              startTime: new Date().toISOString(),
            },
            agentRunSpanId
          );
          assistantResponseSpanId = responseSpanId;
          logger.debug('assistant_response_span_created_fallback', { sessionId, responseSpanId });
        }

        // Finish assistant_response span if one was created (during streaming or fallback)
        if (assistantResponseSpanId) {
          // Use current time, not the endTime captured at the top of the handler,
          // because the fallback path may have created this span after endTime was set.
          const finishTime = Date.now();
          const spanStartTime = (spanManager as any).getSpan(assistantResponseSpanId)?.startTime || finishTime;
          const durationMs = finishTime - spanStartTime;
          const responseResult = {
            text: responseText,
            model: (ctx.model as any)?.id,
            durationMs,
            isError: false,
          };

          // Set pending result BEFORE async finish (guards against finishAllSpans race)
          spanManager.setPendingResult(assistantResponseSpanId, responseResult);
          await spanManager.finishSpan(
            assistantResponseSpanId,
            responseResult as any,
            durationMs
          );

          logger.debug('assistant_response_span_finished', {
            sessionId,
            assistantResponseSpanId,
            durationMs,
          });

          assistantResponseSpanId = null;
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('message_end_error', { error });
    }
  });

  logger.info('extension_loaded', { version: '0.0.1', isConfigured: config.isConfigured });
}
