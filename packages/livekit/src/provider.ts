import { stderr } from 'node:process';
import {
  type AgentInstanceManager,
  type Config,
  getLogger,
  type PrefactorProvider,
  type Tracer,
} from '@prefactor/core';
import {
  DEFAULT_LIVEKIT_AGENT_SCHEMA as DEFAULT_LIVEKIT_AGENT_SCHEMA_BASE,
  normalizeAgentSchema,
} from './schema.js';
import { PrefactorLiveKitSession } from './session.js';
import type { LiveKitMiddleware } from './types.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

const logger = getLogger('livekit');
const SDK_HEADER_ENTRY = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;

export const DEFAULT_LIVEKIT_AGENT_SCHEMA = DEFAULT_LIVEKIT_AGENT_SCHEMA_BASE;

export class PrefactorLiveKit implements PrefactorProvider<LiveKitMiddleware> {
  private toolSpanTypes: Record<string, string> | undefined;
  private readonly sessions = new Set<PrefactorLiveKitSession>();

  createMiddleware(
    tracer: Tracer,
    agentManager: AgentInstanceManager,
    coreConfig: Config,
    getAbortSignal?: () => AbortSignal
  ): LiveKitMiddleware {
    const toolSpanTypes = cloneToolSpanTypes(this.toolSpanTypes);

    return {
      createSessionTracer: (): PrefactorLiveKitSession => {
        const sessionTracer = new PrefactorLiveKitSession({
          tracer,
          agentManager,
          agentInfo: toLiveKitAgentInfo(coreConfig),
          toolSpanTypes,
          getAbortSignal,
          onDidClose: () => {
            this.sessions.delete(sessionTracer);
          },
        });
        this.sessions.add(sessionTracer);
        return sessionTracer;
      },
    };
  }

  async shutdown(): Promise<void> {
    const sessions = [...this.sessions];
    this.sessions.clear();

    for (const session of sessions) {
      try {
        await session.close();
      } catch (error) {
        logShutdownError(error);
      }
    }
  }

  normalizeAgentSchema(agentSchema: Record<string, unknown>): Record<string, unknown> {
    const normalizedSchema = normalizeAgentSchema(agentSchema);
    this.toolSpanTypes = normalizedSchema.toolSpanTypes;
    return normalizedSchema.agentSchema;
  }

  getDefaultAgentSchema(): Record<string, unknown> | undefined {
    return DEFAULT_LIVEKIT_AGENT_SCHEMA;
  }

  getSdkHeaderEntry(): string {
    return SDK_HEADER_ENTRY;
  }
}

function toLiveKitAgentInfo(config: Config):
  | {
      agentId?: string;
      agentIdentifier?: string;
      agentName?: string;
      agentDescription?: string;
    }
  | undefined {
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

function logShutdownError(error: unknown) {
  try {
    logger.warn(
      'PrefactorLiveKit.shutdown() failed while closing an active session tracer.',
      error
    );
  } catch (logError) {
    return writeShutdownFallbackLog(error, logError);
  }
}

function writeShutdownFallbackLog(error: unknown, logError: unknown): void {
  try {
    stderr.write(
      `PrefactorLiveKit.shutdown() failed while reporting a session-tracer close error. shutdown_error=${formatEmergencyLogValue(
        error
      )} logger_error=${formatEmergencyLogValue(logError)}\n`
    );
  } catch {
    // Shutdown cleanup must remain non-throwing even when every logging path fails.
  }
}

function formatEmergencyLogValue(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
}

function cloneToolSpanTypes(
  toolSpanTypes: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!toolSpanTypes) {
    return undefined;
  }

  return { ...toolSpanTypes };
}
