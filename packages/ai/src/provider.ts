import type {
  AgentInstanceManager,
  MiddlewareLike,
  PrefactorProvider,
  Tracer,
} from '@prefactor/core';
import { createPrefactorMiddleware } from './middleware.js';
import type { MiddlewareConfig } from './types.js';

export const DEFAULT_AI_AGENT_SCHEMA = {
  external_identifier: 'ai-sdk-schema',
  span_schemas: {
    'ai-sdk:agent': { type: 'object', additionalProperties: true },
    'ai-sdk:llm': { type: 'object', additionalProperties: true },
    'ai-sdk:tool': { type: 'object', additionalProperties: true },
  },
  span_result_schemas: {
    'ai-sdk:agent': { type: 'object', additionalProperties: true },
    'ai-sdk:llm': { type: 'object', additionalProperties: true },
    'ai-sdk:tool': { type: 'object', additionalProperties: true },
  },
} as const;

export interface PrefactorAISDKOptions {
  middleware?: MiddlewareConfig;
  agentSchema?: Record<string, unknown>;
}

export class PrefactorAISDK implements PrefactorProvider {
  private readonly options: PrefactorAISDKOptions;

  constructor(options: PrefactorAISDKOptions = {}) {
    this.options = options;
  }

  createMiddleware(
    tracer: Tracer,
    agentManager: AgentInstanceManager,
    // biome-ignore lint/suspicious/noExplicitAny: Config shape varies by version
    coreConfig: any
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
    });
  }

  getDefaultAgentSchema(): Record<string, unknown> | undefined {
    return this.options.agentSchema ?? DEFAULT_AI_AGENT_SCHEMA;
  }
}
