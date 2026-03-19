import type { AgentInstanceManager, Config, PrefactorProvider, Tracer } from '@prefactor/core';
import {
  DEFAULT_CLAUDE_AGENT_SCHEMA as DEFAULT_CLAUDE_AGENT_SCHEMA_BASE,
  getToolSpanTypesForAgentSchema,
  normalizeAgentSchema,
} from './schema.js';
import { createClaudeRuntimeController, createTracedQuery } from './traced-query.js';
import type {
  ClaudeAgentInfo,
  ClaudeMiddleware,
  ClaudeMiddlewareConfig,
  ClaudeQuery,
  ClaudeRuntimeController,
} from './types.js';

export const DEFAULT_CLAUDE_AGENT_SCHEMA = DEFAULT_CLAUDE_AGENT_SCHEMA_BASE;

export interface PrefactorClaudeOptions {
  query: ClaudeQuery;
  middleware?: ClaudeMiddlewareConfig;
}

export class PrefactorClaude implements PrefactorProvider<ClaudeMiddleware> {
  private readonly options: PrefactorClaudeOptions;
  private agentManager: AgentInstanceManager | null = null;
  private runtimeController: ClaudeRuntimeController | null = null;

  constructor(options: PrefactorClaudeOptions) {
    this.options = options;
  }

  createMiddleware(
    tracer: Tracer,
    agentManager: AgentInstanceManager,
    coreConfig: Config
  ): ClaudeMiddleware {
    this.agentManager = agentManager;
    const runtimeController = createClaudeRuntimeController();
    this.runtimeController = runtimeController;

    return createTracedQuery(
      this.options.query,
      tracer,
      agentManager,
      toClaudeAgentInfo(coreConfig),
      runtimeController,
      this.options.middleware,
      getToolSpanTypesForAgentSchema(coreConfig.httpConfig?.agentSchema)
    );
  }

  shutdown(): void {
    this.runtimeController?.shutdown(this.agentManager);
    this.agentManager = null;
    this.runtimeController = null;
  }

  normalizeAgentSchema(agentSchema: Record<string, unknown>): Record<string, unknown> {
    return normalizeAgentSchema(agentSchema).agentSchema;
  }

  getDefaultAgentSchema(): Record<string, unknown> | undefined {
    return DEFAULT_CLAUDE_AGENT_SCHEMA;
  }
}

function toClaudeAgentInfo(config: Config): ClaudeAgentInfo | undefined {
  const httpConfig = config.httpConfig;
  if (!httpConfig) {
    return undefined;
  }

  return {
    agentId: httpConfig.agentId,
    agentIdentifier: httpConfig.agentIdentifier,
    agentName: httpConfig.agentName,
    agentDescription: httpConfig.agentDescription,
  };
}
