import {
  getLogger,
  type AgentInstanceManager,
  type Config,
  type PrefactorProvider,
  type Tracer,
} from '@prefactor/core';
import {
  DEFAULT_CLAUDE_AGENT_SCHEMA as DEFAULT_CLAUDE_AGENT_SCHEMA_BASE,
  normalizeAgentSchema,
} from './schema.js';
import { createClaudeRuntimeController, createTracedQuery } from './traced-query.js';
import type {
  ClaudeAgentInfo,
  ClaudeMiddleware,
  ClaudeQuery,
  ClaudeRuntimeController,
} from './types.js';

export const DEFAULT_CLAUDE_AGENT_SCHEMA = DEFAULT_CLAUDE_AGENT_SCHEMA_BASE;
const logger = getLogger('claude');

export interface PrefactorClaudeOptions {
  query: ClaudeQuery;
}

export class PrefactorClaude implements PrefactorProvider<ClaudeMiddleware> {
  private readonly options: PrefactorClaudeOptions;
  private agentManager: AgentInstanceManager | null = null;
  private runtimeController: ClaudeRuntimeController | null = null;
  private toolSpanTypes: Record<string, string> | undefined;

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
      this.toolSpanTypes
    );
  }

  shutdown(): void {
    try {
      this.runtimeController?.shutdown(this.agentManager);
    } catch (error) {
      logShutdownError(error);
    } finally {
      this.agentManager = null;
      this.runtimeController = null;
    }
  }

  normalizeAgentSchema(agentSchema: Record<string, unknown>): Record<string, unknown> {
    const normalizedSchema = normalizeAgentSchema(agentSchema);
    this.toolSpanTypes = normalizedSchema.toolSpanTypes;
    return normalizedSchema.agentSchema;
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

function logShutdownError(error: unknown): void {
  try {
    logger.warn('PrefactorClaude.shutdown() failed during runtimeController.shutdown(...)', error);
  } catch {
    // Logging must never turn shutdown cleanup into a user-visible failure.
  }
}
