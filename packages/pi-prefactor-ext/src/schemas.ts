/**
 * Span Schema Definitions for pi-prefactor-ext
 *
 * Defines TypeScript types for all span types used in Prefactor tracing.
 * Each span type has a payload (input) and result (output) schema.
 *
 * @module
 */

/**
 * pi:session span - Session lifecycle boundary
 */
export interface SessionPayload {
  createdAt: string;
}

export interface SessionResult {
  status: string;
  durationMs: number;
}

/**
 * pi:user_message span - Inbound user message
 */
export interface UserMessagePayload {
  text: string;
  timestamp: string;
}

export interface UserMessageResult {
  reason?: string;
  durationMs?: number;
}

/**
 * pi:agent_run span - Agent execution run
 */
export interface AgentRunPayload {
  model: string;
  temperature?: number;
  systemPrompt?: string;
  systemPromptHash?: string;
  systemPromptLength?: number;
  skillsLoaded?: string[];
  toolsAvailable?: string[];
  userRequest: string;
}

export interface AgentRunResult {
  success: boolean;
  terminationReason: 'completed' | 'error' | 'user_cancel' | 'timeout' | 'session_shutdown';
  error?: string;
  filesModified?: string[];
  filesCreated?: string[];
  filesRead?: string[];
  commandsRun?: number;
  toolCalls?: number;
  durationMs: number;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * pi:tool_call span - Generic tool execution
 */
export interface ToolCallPayload {
  toolName: string;
  toolCallId: string;
  input?: Record<string, unknown>;
}

export interface ToolCallResult {
  output?: string;
  isError: boolean;
  durationMs?: number;
}

/**
 * pi:tool:bash span - Bash command execution
 */
export interface BashToolPayload {
  toolCallId: string;
  startTime: string;
  command: string;
  timeout?: number;
  cwd?: string;
}

export interface BashToolResult {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  isError?: boolean;
}

/**
 * pi:tool:read span - File read operation
 */
export interface ReadToolPayload {
  toolCallId: string;
  startTime: string;
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadToolResult {
  contentLength?: number;
  lineCount?: number;
  encoding?: string;
  isError?: boolean;
}

/**
 * pi:tool:write span - File write operation
 */
export interface WriteToolPayload {
  toolCallId: string;
  startTime: string;
  path: string;
  contentLength?: number;
  created?: boolean;
}

export interface WriteToolResult {
  success?: boolean;
  backupPath?: string;
  isError?: boolean;
}

/**
 * pi:tool:edit span - File edit operation
 */
export interface EditToolPayload {
  toolCallId: string;
  startTime: string;
  path: string;
  editCount?: number;
}

export interface EditToolResult {
  successCount?: number;
  failedCount?: number;
  isError?: boolean;
}

/**
 * pi:assistant_response span - Assistant response message to user
 */
export interface AssistantResponsePayload {
  text: string;
  model?: string;
  provider?: string;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
}

export interface AssistantResponseResult {
  durationMs: number;
  isError: boolean;
}

/**
 * pi:assistant_thinking span - Assistant thinking/reasoning
 */
export interface AssistantThinkingPayload {
  thinking?: string;
  model?: string;
  provider?: string;
  startTime: string;
}

export interface AssistantThinkingResult {
  thinking?: string;
  durationMs: number;
  isError: boolean;
}

/**
 * Union type of all span payload types
 */
export type AnySpanPayload =
  | SessionPayload
  | UserMessagePayload
  | AgentRunPayload
  | ToolCallPayload
  | BashToolPayload
  | ReadToolPayload
  | WriteToolPayload
  | EditToolPayload
  | AssistantResponsePayload
  | AssistantThinkingPayload;

/**
 * Union type of all span result types
 */
export type AnySpanResult =
  | SessionResult
  | UserMessageResult
  | AgentRunResult
  | ToolCallResult
  | BashToolResult
  | ReadToolResult
  | WriteToolResult
  | EditToolResult
  | AssistantResponseResult
  | AssistantThinkingResult;

/**
 * Span schema name type
 */
export type SpanSchemaName =
  | 'pi:session'
  | 'pi:user_message'
  | 'pi:agent_run'
  | 'pi:tool_call'
  | 'pi:tool:bash'
  | 'pi:tool:read'
  | 'pi:tool:write'
  | 'pi:tool:edit'
  | 'pi:assistant_response'
  | 'pi:assistant_thinking';

// ============================================================================
// Schema Metadata (template + description for Prefactor UI)
// ============================================================================

/**
 * Metadata for a span schema used by the Prefactor UI dashboard.
 *
 * - `description`: Human-readable description shown in the schema registry
 * - `template`: Liquid-style template string rendered as a snapshot in the
 *   span list view. References payload fields using `{{ fieldName }}` syntax
 *   with optional filters like `| truncate: N` or `| default: "fallback"`.
 *   Rendered against the merged payload + result_payload after span completion.
 * - `resultTemplate`: Optional template rendered against the result_payload
 *   only. Used when the most useful preview field lives in the result rather
 *   than the payload.
 */
export interface SpanSchemaMetadata {
  description: string;
  template: string | null;
  resultTemplate?: string | null;
}

/**
 * Schema metadata for all span types.
 *
 * Templates use Liquid-style syntax referencing payload fields.
 * The Prefactor UI renders these as a one-line snapshot in the span list.
 */
export const SPAN_SCHEMA_METADATA: Record<SpanSchemaName, SpanSchemaMetadata> = {
  'pi:session': {
    description: 'Pi session lifecycle',
    template: null,
    resultTemplate: null,
  },
  'pi:user_message': {
    description: 'Inbound user message',
    template: '{{ text | default: "(no message)" }}',
    resultTemplate: null,
  },
  'pi:agent_run': {
    description: 'Agent execution run',
    template: '{{ model | default: "unknown" }}',
    resultTemplate: null,
  },
  'pi:tool_call': {
    description: 'Tool execution',
    template: '{{ toolName | default: "(unknown tool)" }}',
    resultTemplate: null,
  },
  'pi:tool:bash': {
    description: 'Bash command execution',
    template: '{{ command | truncate: 100 }}',
    resultTemplate: null,
  },
  'pi:tool:read': {
    description: 'File read operation',
    template: '{{ path | truncate: 100 }}',
    resultTemplate: null,
  },
  'pi:tool:write': {
    description: 'File write operation',
    template: '{{ path | truncate: 100 }}',
    resultTemplate: null,
  },
  'pi:tool:edit': {
    description: 'File edit operation',
    template: '{{ path | truncate: 100 }}',
    resultTemplate: null,
  },
  'pi:assistant_response': {
    description: 'Assistant response message to user',
    template: '{{ model | default: "unknown" }}',
    resultTemplate: '{{ text | truncate: 100 }}',
  },
  'pi:assistant_thinking': {
    description: 'Assistant thinking/reasoning',
    template: '{{ thinking | truncate: 100 }}',
    resultTemplate: null,
  },
};
