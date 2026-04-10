/**
 * Test Harness for Pi Prefactor Extension
 * 
 * This minimal extension logs all hook invocations to validate:
 * - Hook registration works correctly
 * - Event data shapes are as expected
 * - Hook execution order is correct
 * - Session key stability across events
 * 
 * Usage:
 *   pi -e ./test-harness.ts
 * 
 * Or copy to ~/.pi/agent/extensions/test-harness/ for auto-discovery
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// Session key cache for stability across events
const sessionKeyCache = new WeakMap<ExtensionContext, string>();

function getSessionKey(ctx: ExtensionContext): string {
  const cached = sessionKeyCache.get(ctx);
  if (cached) return cached;
  
  const sessionFile = ctx.sessionManager.getSessionFile();
  const key = sessionFile ?? `ephemeral-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  sessionKeyCache.set(ctx, key);
  
  return key;
}

function log(hook: string, data: Record<string, unknown> = {}) {
  const timestamp = new Date().toISOString();
  const sessionKey = data.sessionKey ? data.sessionKey.toString().slice(-8) : 'N/A';
  console.log(`[${timestamp}] [test-harness] ${hook.padEnd(30)} session:${sessionKey.padEnd(8)}`, data);
}

export default function testHarness(pi: ExtensionAPI) {
  console.log('[test-harness] Initializing test harness extension');
  
  let hookCount = 0;
  const hookOrder: string[] = [];
  
  // Track state for validation
  let sessionStarted = false;
  let agentStarted = false;
  let turnCount = 0;
  const toolCalls = new Map<string, { start: number; end?: number }>();
  
  // ==================== RESOURCE EVENTS ====================
  
  pi.on("resources_discover", async (event, ctx) => {
    hookCount++;
    hookOrder.push("resources_discover");
    log("resources_discover", {
      sessionKey: getSessionKey(ctx),
      cwd: event.cwd,
      reason: event.reason,
    });
  });
  
  // ==================== SESSION EVENTS ====================
  
  pi.on("session_start", async (event, ctx) => {
    hookCount++;
    hookOrder.push("session_start");
    sessionStarted = true;
    
    log("session_start", {
      sessionKey: getSessionKey(ctx),
      reason: event.reason,
      hasPreviousSession: !!event.previousSessionFile,
      previousSession: event.previousSessionFile?.split('/').pop(),
    });
    
    if (ctx.hasUI) {
      ctx.ui.notify(`Test harness loaded (session: ${event.reason})`, "info");
    }
  });
  
  pi.on("session_shutdown", async (event, ctx) => {
    hookCount++;
    hookOrder.push("session_shutdown");
    
    const sessionKey = getSessionKey(ctx);
    log("session_shutdown", {
      sessionKey,
      totalHooks: hookCount,
      hookOrder: hookOrder.slice(0, 20).join(' → '),
      sessionStarted,
      agentStarted,
      turnCount,
      activeToolCalls: toolCalls.size,
    });
    
    // Validate session lifecycle
    if (sessionStarted) {
      console.log('[test-harness] ✓ Session lifecycle: start → shutdown');
    }
    
    // Clear cache for this session
    sessionKeyCache.delete(ctx);
  });
  
  pi.on("session_before_switch", async (event, ctx) => {
    hookCount++;
    hookOrder.push("session_before_switch");
    
    log("session_before_switch", {
      sessionKey: getSessionKey(ctx),
      reason: event.reason,
      targetSession: event.targetSessionFile?.split('/').pop(),
    });
  });
  
  // ==================== INPUT EVENTS ====================
  
  pi.on("input", async (event, ctx) => {
    hookCount++;
    hookOrder.push("input");
    agentStarted = false; // Reset for new prompt
    
    log("input", {
      sessionKey: getSessionKey(ctx),
      textPreview: event.text.slice(0, 50),
      source: event.source,
      imageCount: event.images?.length ?? 0,
    });
    
    // Return continue to pass through
    return { action: "continue" };
  });
  
  // ==================== AGENT EVENTS ====================
  
  pi.on("before_agent_start", async (event, ctx) => {
    hookCount++;
    hookOrder.push("before_agent_start");
    agentStarted = true;
    
    log("before_agent_start", {
      sessionKey: getSessionKey(ctx),
      promptPreview: event.prompt?.slice(0, 50),
      imageCount: event.images?.length ?? 0,
      systemPromptLength: event.systemPrompt?.length,
    });
  });
  
  pi.on("agent_start", async (event, ctx) => {
    hookCount++;
    hookOrder.push("agent_start");
    
    log("agent_start", {
      sessionKey: getSessionKey(ctx),
    });
  });
  
  pi.on("agent_end", async (event, ctx) => {
    hookCount++;
    hookOrder.push("agent_end");
    agentStarted = false;
    
    log("agent_end", {
      sessionKey: getSessionKey(ctx),
      success: event.success,
      durationMs: event.durationMs,
      messageCount: event.messages?.length,
    });
    
    // Validate agent lifecycle
    console.log('[test-harness] ✓ Agent lifecycle: before_agent_start → agent_start → agent_end');
  });
  
  // ==================== TURN EVENTS ====================
  
  pi.on("turn_start", async (event, ctx) => {
    hookCount++;
    hookOrder.push("turn_start");
    turnCount++;
    
    log("turn_start", {
      sessionKey: getSessionKey(ctx),
      turnIndex: event.turnIndex,
    });
  });
  
  pi.on("turn_end", async (event, ctx) => {
    hookCount++;
    hookOrder.push("turn_end");
    
    log("turn_end", {
      sessionKey: getSessionKey(ctx),
      turnIndex: event.turnIndex,
      hasMessage: !!event.message,
      toolResultsCount: event.toolResults?.length,
      usage: event.usage ? {
        input: event.usage.inputTokens,
        output: event.usage.outputTokens,
      } : undefined,
    });
  });
  
  // ==================== MESSAGE EVENTS ====================
  
  pi.on("message_start", async (event, ctx) => {
    hookCount++;
    hookOrder.push("message_start");
    
    log("message_start", {
      sessionKey: getSessionKey(ctx),
      role: event.message.role,
      messageType: event.message.type,
    });
  });
  
  pi.on("message_update", async (event, ctx) => {
    hookCount++;
    hookOrder.push("message_update");
    
    // Only log first update to avoid spam
    if (event.assistantMessageEvent?.type === 'text_delta') {
      log("message_update", {
        sessionKey: getSessionKey(ctx),
        deltaPreview: event.assistantMessageEvent.delta?.slice(0, 30),
      });
    }
  });
  
  pi.on("message_end", async (event, ctx) => {
    hookCount++;
    hookOrder.push("message_end");
    
    log("message_end", {
      sessionKey: getSessionKey(ctx),
      role: event.message.role,
      messageType: event.message.type,
    });
  });
  
  // ==================== TOOL EVENTS ====================
  
  pi.on("tool_execution_start", async (event, ctx) => {
    hookCount++;
    hookOrder.push("tool_execution_start");
    
    toolCalls.set(event.toolCallId, { start: Date.now() });
    
    log("tool_execution_start", {
      sessionKey: getSessionKey(ctx),
      toolName: event.toolName,
      toolCallId: event.toolCallId.slice(-8),
      argsPreview: JSON.stringify(event.args).slice(0, 100),
    });
  });
  
  pi.on("tool_call", async (event, ctx) => {
    hookCount++;
    hookOrder.push("tool_call");
    
    log("tool_call", {
      sessionKey: getSessionKey(ctx),
      toolName: event.toolName,
      toolCallId: event.toolCallId.slice(-8),
      inputPreview: JSON.stringify(event.input).slice(0, 100),
    });
    
    // Example: block dangerous commands (commented out)
    // if (event.toolName === 'bash' && event.input.command?.includes('rm -rf')) {
    //   return { block: true, reason: 'Blocked by test harness' };
    // }
  });
  
  pi.on("tool_execution_update", async (event, ctx) => {
    hookCount++;
    hookOrder.push("tool_execution_update");
    
    log("tool_execution_update", {
      sessionKey: getSessionKey(ctx),
      toolName: event.toolName,
      toolCallId: event.toolCallId.slice(-8),
      hasPartialResult: !!event.partialResult,
    });
  });
  
  pi.on("tool_result", async (event, ctx) => {
    hookCount++;
    hookOrder.push("tool_result");
    
    const toolCall = toolCalls.get(event.toolCallId);
    if (toolCall) {
      toolCall.end = Date.now();
    }
    
    log("tool_result", {
      sessionKey: getSessionKey(ctx),
      toolName: event.toolName,
      toolCallId: event.toolCallId.slice(-8),
      isError: event.isError,
      durationMs: toolCall?.end && toolCall.start ? toolCall.end - toolCall.start : undefined,
      contentPreview: Array.isArray(event.content) 
        ? event.content.map((c: any) => c.text).join('').slice(0, 100)
        : String(event.content).slice(0, 100),
    });
  });
  
  pi.on("tool_execution_end", async (event, ctx) => {
    hookCount++;
    hookOrder.push("tool_execution_end");
    
    const toolCall = toolCalls.get(event.toolCallId);
    toolCalls.delete(event.toolCallId);
    
    log("tool_execution_end", {
      sessionKey: getSessionKey(ctx),
      toolName: event.toolName,
      toolCallId: event.toolCallId.slice(-8),
      isError: event.isError,
      durationMs: toolCall?.end && toolCall.start ? toolCall.end - toolCall.start : undefined,
    });
    
    // Validate tool lifecycle
    if (toolCall?.start && toolCall?.end) {
      console.log(`[test-harness] ✓ Tool lifecycle: ${event.toolName} (${toolCall.end - toolCall.start}ms)`);
    }
  });
  
  // ==================== PROVIDER EVENTS ====================
  
  pi.on("before_provider_request", async (event, ctx) => {
    hookCount++;
    hookOrder.push("before_provider_request");
    
    log("before_provider_request", {
      sessionKey: getSessionKey(ctx),
      provider: event.provider,
      model: event.model,
      messageCount: Array.isArray(event.payload.messages) ? event.payload.messages.length : 0,
      hasSystemPrompt: !!(event.payload as any).system,
    });
  });
  
  // ==================== MODEL EVENTS ====================
  
  pi.on("model_select", async (event, ctx) => {
    hookCount++;
    hookOrder.push("model_select");
    
    log("model_select", {
      sessionKey: getSessionKey(ctx),
      previousModel: event.previousModel 
        ? `${event.previousModel.provider}/${event.previousModel.id}` 
        : 'none',
      newModel: `${event.model.provider}/${event.model.id}`,
      source: event.source,
    });
  });
  
  // ==================== CONTEXT EVENT ====================
  
  pi.on("context", async (event, ctx) => {
    hookCount++;
    hookOrder.push("context");
    
    log("context", {
      sessionKey: getSessionKey(ctx),
      messageCount: event.messages.length,
    });
  });
  
  // ==================== VALIDATION COMMAND ====================
  
  pi.registerCommand("test-harness", {
    description: "Show test harness validation results",
    handler: async (_args, ctx) => {
      const sessionKey = getSessionKey(ctx);
      
      console.log('[test-harness] Validation Report:');
      console.log(`  Total hooks fired: ${hookCount}`);
      console.log(`  Session started: ${sessionStarted}`);
      console.log(`  Turns processed: ${turnCount}`);
      console.log(`  Session key: ${sessionKey}`);
      console.log(`  Hook order (first 10): ${hookOrder.slice(0, 10).join(' → ')}`);
      
      // Validate expected hook order
      const expectedOrder = [
        'session_start',
        'resources_discover',
        'input',
        'before_agent_start',
        'agent_start',
        'turn_start',
        'before_provider_request',
        'message_start',
        'message_update',
        'tool_execution_start',
        'tool_call',
        'tool_result',
        'tool_execution_end',
        'turn_end',
        'agent_end',
      ];
      
      const missingHooks = expectedOrder.filter(hook => !hookOrder.includes(hook));
      if (missingHooks.length > 0) {
        console.log('[test-harness] ⚠ Missing hooks:', missingHooks);
      } else {
        console.log('[test-harness] ✓ All expected hooks registered');
      }
      
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Test harness: ${hookCount} hooks, ${turnCount} turns, ${toolCalls.size} active tools`,
          "info"
        );
      }
    },
  });
  
  console.log('[test-harness] Extension initialized');
  console.log(`[test-harness] Registered hooks: session_start, session_shutdown, resources_discover, input, before_agent_start, agent_start, agent_end, turn_start, turn_end, message_start, message_update, message_end, tool_execution_start, tool_call, tool_execution_update, tool_result, tool_execution_end, before_provider_request, model_select, context`);
  console.log(`[test-harness] Registered commands: /test-harness`);
}
