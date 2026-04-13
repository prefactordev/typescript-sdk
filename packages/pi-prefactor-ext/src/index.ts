/**
 * Pi Prefactor Extension - MVP
 * 
 * Instruments pi coding agent with Prefactor spans for distributed tracing.
 * 
 * @module
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import packageJson from '../../package.json' with { type: 'json' };
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
  logger.info('config_loaded', getConfigSummary(config));
  
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
  
  // ==================== SESSION HOOKS ====================
  
  pi.on("session_start", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    logger.info('session_start', { reason: event.reason, sessionKey });
    await sessionManager.createSessionSpan(sessionKey);
  });
  
  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    logger.info('session_shutdown', { sessionKey });
    
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
    
    logger.info('input', {
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
    
    logger.info('before_agent_start', {
      sessionKey,
      promptPreview: event.prompt?.slice(0, 50),
      messageCount: event.messages?.length,
    });
    
    if (pendingUserMessage) {
      pendingUserMessage = null;
    }
    
    await sessionManager.createAgentRunSpan(sessionKey, {
      messageCount: event.messages?.length || 0,
    });
  });
  
  pi.on("agent_end", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    
    logger.info('agent_end', {
      sessionKey,
      success: event.success,
      messageCount: event.messages?.length,
    });
    
    // Always use 'complete' for normal agent exit
    // (failed status is only for explicit errors, not cleanup)
    await sessionManager.closeAgentRunSpan(sessionKey, 'complete');
  });
  
  // ==================== TURN HOOKS ====================
  
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
  });
  
  // ==================== TOOL HOOKS ====================
  
  pi.on("tool_execution_start", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    
    logger.info('tool_execution_start', {
      sessionKey,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
    });
    
    const payload: Record<string, unknown> = {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
    };
    
    if (config.captureToolInputs) {
      payload.input = event.args;
    }
    
    // CRITICAL: Await span creation to prevent race condition with tool_result
    await sessionManager.createToolCallSpan(sessionKey, event.toolName, payload);
    
    logger.debug('tool_span_creation_complete', {
      sessionKey,
      toolCallId: event.toolCallId,
    });
  });
  
  pi.on("tool_result", async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    const resultText = extractTextFromContent(event.content);
    const isError = event.isError ?? false;
    
    logger.info('tool_result', {
      sessionKey,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      isError,
    });
    
    await sessionManager.closeToolCallSpanWithResult(
      sessionKey,
      event.toolCallId,
      event.toolName,
      resultText,
      isError
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
    hooks: 11,
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
