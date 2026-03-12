import type {
  AgentInstanceManager,
  Config,
  MiddlewareLike,
  PrefactorProvider,
  Tracer,
} from '@prefactor/core';
import { createPrefactorMiddleware } from './middleware.js';
import {
  DEFAULT_AI_AGENT_SCHEMA as DEFAULT_AI_AGENT_SCHEMA_BASE,
  normalizeAgentSchema,
} from './schema.js';
import type { MiddlewareConfig } from './types.js';

export const DEFAULT_AI_AGENT_SCHEMA = DEFAULT_AI_AGENT_SCHEMA_BASE;

export interface PrefactorAISDKOptions {
  middleware?: MiddlewareConfig;
  agentSchema?: Record<string, unknown>;
}

export class PrefactorAISDK implements PrefactorProvider {
  private readonly options: PrefactorAISDKOptions;
  private toolSpanTypes: Record<string, string> | undefined;

  constructor(options: PrefactorAISDKOptions = {}) {
    this.options = options;
  }

  createMiddleware(
    tracer: Tracer,
    agentManager: AgentInstanceManager,
    coreConfig: Config
  ): MiddlewareLike {
    const httpConfig = coreConfig.httpConfig;
    const agentInfo = httpConfig
      ? {
          agentId: httpConfig.agentId,
          agentIdentifier: httpConfig.agentIdentifier,
          agentName: httpConfig.agentName,
          agentDescription: httpConfig.agentDescription,
        }
      : undefined;

    const agentLifecycle = { started: false };

    return createPrefactorMiddleware(tracer, this.options.middleware, {
      agentManager,
      agentInfo,
      agentLifecycle,
      deadTimeoutMs: 5 * 60 * 1000,
      toolSpanTypes: this.toolSpanTypes,
    });
  }

  normalizeAgentSchema(agentSchema: Record<string, unknown>): Record<string, unknown> {
    const normalizedSchema = normalizeAgentSchema(agentSchema);
    this.toolSpanTypes = normalizedSchema.toolSpanTypes;
    return normalizedSchema.agentSchema;
  }

  getDefaultAgentSchema(): Record<string, unknown> | undefined {
    return this.options.agentSchema ?? DEFAULT_AI_AGENT_SCHEMA;
  }
}
