import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { JsonSchema, Span, ToolSchemaConfig } from '@prefactor/core';

/**
 * Configuration options for the Prefactor Claude middleware.
 */
export interface ClaudeMiddlewareConfig {
  /**
   * Whether to capture assistant message content in LLM spans.
   * Set to false to reduce data volume or for privacy reasons.
   * @default true
   */
  captureContent?: boolean;

  /**
   * Whether to capture tool inputs/outputs.
   * @default true
   */
  captureTools?: boolean;
}

/**
 * Middleware returned by PrefactorClaude.createMiddleware().
 */
export interface ClaudeMiddleware {
  tracedQuery: (
    ...args: Parameters<typeof import('@anthropic-ai/claude-agent-sdk').query>
  ) => Query;
}

/**
 * Shared mutable state between hooks and stream tap.
 */
export interface TracedQueryState {
  currentLlmSpan: Span | null;
  currentLlmOutputs: Record<string, unknown>;
  agentSpan: Span | null;
  agentSpanFinished: boolean;
  toolSpanMap: Map<string, Span>;
  subagentSpanMap: Map<string, Span>;
}

export type { JsonSchema, ToolSchemaConfig };
