import type { AgentInstanceManager, Config, PrefactorProvider, Tracer } from '@prefactor/core';
import { createPrefactorMiddleware } from './middleware.js';
import {
  DEFAULT_AI_AGENT_SCHEMA as DEFAULT_AI_AGENT_SCHEMA_BASE,
  normalizeAgentSchema,
} from './schema.js';
import type { LanguageModelMiddleware, MiddlewareConfig } from './types.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

export const DEFAULT_AI_AGENT_SCHEMA = DEFAULT_AI_AGENT_SCHEMA_BASE;
const AI_SDK_PACKAGE = {
  packageName: PACKAGE_NAME,
  version: PACKAGE_VERSION,
} as const;

export interface PrefactorAISDKOptions {
  middleware?: MiddlewareConfig;
  agentSchema?: Record<string, unknown>;
}

export class PrefactorAISDK implements PrefactorProvider<LanguageModelMiddleware> {
  private readonly options: PrefactorAISDKOptions;
  private toolSpanTypes: Record<string, string> | undefined;
  private agentManager: AgentInstanceManager | null = null;
  private agentLifecycle: { started: boolean } | null = null;

  constructor(options: PrefactorAISDKOptions = {}) {
    this.options = options;
  }

  createMiddleware(
    tracer: Tracer,
    agentManager: AgentInstanceManager,
    coreConfig: Config
  ): LanguageModelMiddleware {
    this.agentManager = agentManager;
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
    this.agentLifecycle = agentLifecycle;

    return createPrefactorMiddleware(tracer, this.options.middleware, {
      agentManager,
      agentInfo,
      agentLifecycle,
      deadTimeoutMs: 5 * 60 * 1000,
      toolSpanTypes: this.toolSpanTypes,
    });
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
    return this.options.agentSchema ?? DEFAULT_AI_AGENT_SCHEMA;
  }

  getSdkPackages(): Array<{ packageName: string; version: string }> {
    return [AI_SDK_PACKAGE];
  }
}
