import type { AgentInstanceManager, Config, PrefactorProvider, Tracer } from '@prefactor/core';
import { type AgentMiddleware, createMiddleware } from 'langchain';
import { PrefactorMiddleware } from './middleware.js';
import {
  DEFAULT_LANGCHAIN_AGENT_SCHEMA as DEFAULT_LANGCHAIN_AGENT_SCHEMA_BASE,
  normalizeAgentSchema,
} from './schema.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

export const DEFAULT_LANGCHAIN_AGENT_SCHEMA = DEFAULT_LANGCHAIN_AGENT_SCHEMA_BASE;
const SDK_HEADER_ENTRY = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;

export interface PrefactorLangChainOptions {
  agentSchema?: Record<string, unknown>;
}

export class PrefactorLangChain implements PrefactorProvider<AgentMiddleware> {
  private readonly options: PrefactorLangChainOptions;
  private middleware: PrefactorMiddleware | null = null;
  private toolSpanTypes: Record<string, string> | undefined;

  constructor(options: PrefactorLangChainOptions = {}) {
    this.options = options;
  }

  createMiddleware(
    tracer: Tracer,
    agentManager: AgentInstanceManager,
    coreConfig: Config,
    getAbortSignal?: () => AbortSignal
  ): AgentMiddleware {
    const httpConfig = coreConfig.httpConfig;
    const agentInfo = httpConfig
      ? {
          agentId: httpConfig.agentId,
          agentIdentifier: httpConfig.agentIdentifier,
          agentName: httpConfig.agentName,
          agentDescription: httpConfig.agentDescription,
        }
      : undefined;

    this.middleware = new PrefactorMiddleware(
      tracer,
      agentManager,
      agentInfo,
      this.toolSpanTypes,
      getAbortSignal
    );
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

  resetForNextRun(): void {
    this.middleware?.shutdown();
  }

  shutdown(): void {
    this.middleware?.shutdown();
    this.middleware = null;
  }

  getSdkHeaderEntry(): string {
    return SDK_HEADER_ENTRY;
  }

  normalizeAgentSchema(agentSchema: Record<string, unknown>): Record<string, unknown> {
    const normalizedSchema = normalizeAgentSchema(agentSchema);
    this.toolSpanTypes = normalizedSchema.toolSpanTypes;
    return normalizedSchema.agentSchema;
  }

  getDefaultAgentSchema(): Record<string, unknown> | undefined {
    return this.options.agentSchema ?? DEFAULT_LANGCHAIN_AGENT_SCHEMA;
  }
}
