import type { AgentInstanceManager, Config, PrefactorProvider, Tracer } from '@prefactor/core';
import {
  DEFAULT_CLAUDE_AGENT_SCHEMA as DEFAULT_CLAUDE_AGENT_SCHEMA_BASE,
  normalizeAgentSchema,
} from './schema.js';
import { createTracedQuery } from './traced-query.js';
import type { ClaudeMiddleware, ClaudeMiddlewareConfig } from './types.js';

export const DEFAULT_CLAUDE_AGENT_SCHEMA = DEFAULT_CLAUDE_AGENT_SCHEMA_BASE;

export interface PrefactorClaudeOptions {
  middleware?: ClaudeMiddlewareConfig;
  agentSchema?: Record<string, unknown>;
}

export class PrefactorClaude implements PrefactorProvider<ClaudeMiddleware> {
  private readonly options: PrefactorClaudeOptions;
  private toolSpanTypes: Record<string, string> | undefined;
  private agentManager: AgentInstanceManager | null = null;
  private agentLifecycle: { started: boolean } | null = null;

  constructor(options: PrefactorClaudeOptions = {}) {
    this.options = options;
  }

  createMiddleware(
    tracer: Tracer,
    agentManager: AgentInstanceManager,
    coreConfig: Config
  ): ClaudeMiddleware {
    this.agentManager = agentManager;

    const agentLifecycle = { started: false };
    this.agentLifecycle = agentLifecycle;

    return createTracedQuery(
      tracer,
      agentManager,
      coreConfig,
      this.options.middleware,
      this.toolSpanTypes,
      agentLifecycle
    );
  }

  shutdown(): void {
    if (this.agentLifecycle?.started) {
      this.agentManager?.finishInstance();
      this.agentLifecycle.started = false;
    }

    this.agentManager = null;
    this.agentLifecycle = null;
  }

  normalizeAgentSchema(agentSchema: Record<string, unknown>): Record<string, unknown> {
    const normalizedSchema = normalizeAgentSchema(agentSchema);
    this.toolSpanTypes = normalizedSchema.toolSpanTypes;
    return normalizedSchema.agentSchema;
  }

  getDefaultAgentSchema(): Record<string, unknown> | undefined {
    return this.options.agentSchema ?? DEFAULT_CLAUDE_AGENT_SCHEMA;
  }
}
