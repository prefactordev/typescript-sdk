import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentInstanceManager,
  AgentInstanceOptions,
  JsonSchema,
  Span,
  ToolSchemaConfig,
} from '@prefactor/core';

export type ClaudeQuery = typeof import('@anthropic-ai/claude-agent-sdk').query;

/**
 * Middleware returned by PrefactorClaude.createMiddleware().
 */
export interface ClaudeMiddleware {
  tracedQuery: (...args: Parameters<ClaudeQuery>) => Query;
}

export interface ClaudeAgentInfo extends AgentInstanceOptions {}

export interface ClaudeRuntimeController {
  claimRun(): symbol;
  startAgentInstance(
    token: symbol,
    agentManager: AgentInstanceManager,
    agentInfo?: ClaudeAgentInfo
  ): void;
  finishAgentInstance(token: symbol, agentManager: AgentInstanceManager): void;
  releaseRun(token: symbol): void;
  shutdown(agentManager?: AgentInstanceManager | null): void;
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
