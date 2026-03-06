import type {
  AgentInstanceManager,
  MiddlewareLike,
  PrefactorProvider,
  Tracer,
} from '@prefactor/core';
import { createMiddleware } from 'langchain';
import { PrefactorMiddleware } from './middleware.js';

export const DEFAULT_LANGCHAIN_AGENT_SCHEMA = {
  external_identifier: 'langchain-schema',
  span_schemas: {
    'langchain:agent': { type: 'object', additionalProperties: true },
    'langchain:llm': { type: 'object', additionalProperties: true },
    'langchain:tool': { type: 'object', additionalProperties: true },
    'langchain:chain': { type: 'object', additionalProperties: true },
  },
  span_result_schemas: {
    'langchain:agent': { type: 'object', additionalProperties: true },
    'langchain:llm': { type: 'object', additionalProperties: true },
    'langchain:tool': { type: 'object', additionalProperties: true },
    'langchain:chain': { type: 'object', additionalProperties: true },
  },
} as const;

export interface PrefactorLangChainOptions {
  agentSchema?: Record<string, unknown>;
}

export class PrefactorLangChain implements PrefactorProvider {
  private readonly options: PrefactorLangChainOptions;
  private middleware: PrefactorMiddleware | null = null;

  constructor(options: PrefactorLangChainOptions = {}) {
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

    this.middleware = new PrefactorMiddleware(tracer, agentManager, agentInfo);
    const middleware = this.middleware;

    return createMiddleware({
      name: 'prefactor',
      // biome-ignore lint/suspicious/noExplicitAny: LangChain middleware hooks use dynamic types
      wrapModelCall: async (request: any, handler: any) => {
        return middleware.wrapModelCall(request, handler);
      },
      // biome-ignore lint/suspicious/noExplicitAny: LangChain middleware hooks use dynamic types
      wrapToolCall: async (request: any, handler: any) => {
        return middleware.wrapToolCall(request, handler);
      },
      // biome-ignore lint/suspicious/noExplicitAny: LangChain middleware hooks use dynamic types
      beforeAgent: async (state: any) => {
        await middleware.beforeAgent(state);
      },
      // biome-ignore lint/suspicious/noExplicitAny: LangChain middleware hooks use dynamic types
      afterAgent: async (state: any) => {
        await middleware.afterAgent(state);
      },
    });
  }

  shutdown(): void {
    this.middleware?.shutdown();
    this.middleware = null;
  }

  getDefaultAgentSchema(): Record<string, unknown> | undefined {
    return this.options.agentSchema ?? DEFAULT_LANGCHAIN_AGENT_SCHEMA;
  }
}
