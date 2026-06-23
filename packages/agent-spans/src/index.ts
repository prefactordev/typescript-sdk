/**
 * Thin Prefactor API client for forwarding pre-mapped agent spans.
 *
 * This package does not instrument code or map provider payloads. It only wraps
 * @prefactor/core HTTP endpoint clients for callers that already have span
 * payloads and need stable agent instance/span lifecycle calls.
 *
 * @module @prefactor/agent-spans
 * @category Packages
 * @packageDocumentation
 */

import {
  AgentInstanceClient,
  type AgentSchemaVersion,
  AgentSpanClient,
  type AgentSpanStatus,
  HttpClient,
  HttpClientError,
} from '@prefactor/core';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

export { HttpClientError };

export type ExternalAgentSpanStatus = Extract<AgentSpanStatus, 'complete' | 'failed'>;

export type ExternalAgentSpan = {
  externalSpanId: string;
  parentExternalSpanId: string | null;
  schemaName: string;
  status: ExternalAgentSpanStatus;
  startedAt: string;
  finishedAt: string | null;
  payload: Record<string, unknown>;
  resultPayload?: Record<string, unknown> | null;
};

export type AgentVersionConfig = {
  externalIdentifier: string;
  name: string;
  description: string;
};

export type PrefactorAgentSpanClientConfig = {
  apiUrl: string;
  apiToken: string;
  agentId: string;
  environmentId: string;
  agentVersion: AgentVersionConfig;
  requestTimeoutMs?: number;
};

export type PrefactorAgentSpanClientDependencies = {
  fetchFn?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
};

export class PrefactorAgentSpanClient {
  private readonly agentInstances: AgentInstanceClient;
  private readonly agentSpans: AgentSpanClient;
  private readonly externalToBackendSpanIds = new Map<string, string>();

  constructor(
    private readonly config: PrefactorAgentSpanClientConfig,
    dependencies: PrefactorAgentSpanClientDependencies = {}
  ) {
    const httpClient = new HttpClient(
      {
        apiUrl: config.apiUrl,
        apiToken: config.apiToken,
        agentIdentifier: config.agentVersion.externalIdentifier,
        requestTimeout: config.requestTimeoutMs ?? 30000,
        maxRetries: 3,
        initialRetryDelay: 1000,
        maxRetryDelay: 60000,
        retryMultiplier: 2,
        retryOnStatusCodes: [429, ...Array.from({ length: 100 }, (_value, index) => 500 + index)],
      },
      dependencies,
      `${PACKAGE_NAME}@${PACKAGE_VERSION}`
    );
    this.agentInstances = new AgentInstanceClient(httpClient);
    this.agentSpans = new AgentSpanClient(httpClient);
  }

  async registerAndStartInstance(agentSchemaVersion: AgentSchemaVersion): Promise<string> {
    const registered = await this.agentInstances.register({
      agent_id: this.config.agentId,
      environment_id: this.config.environmentId,
      agent_version: {
        external_identifier: this.config.agentVersion.externalIdentifier,
        name: this.config.agentVersion.name,
        description: this.config.agentVersion.description,
      },
      agent_schema_version: agentSchemaVersion,
    });

    const agentInstanceId = registered.details?.id;
    if (!agentInstanceId) {
      throw new Error('Prefactor register response did not include details.id');
    }

    await this.agentInstances.start(agentInstanceId);
    return agentInstanceId;
  }

  async createSpan(agentInstanceId: string, span: ExternalAgentSpan): Promise<string> {
    const parentSpanId = span.parentExternalSpanId
      ? (this.externalToBackendSpanIds.get(span.parentExternalSpanId) ?? null)
      : null;

    const response = await this.agentSpans.create({
      details: {
        agent_instance_id: agentInstanceId,
        parent_span_id: parentSpanId,
        schema_name: span.schemaName,
        status: span.status,
        started_at: span.startedAt,
        finished_at: span.finishedAt,
        payload: span.payload,
        result_payload: span.resultPayload ?? {},
      },
    });

    const backendSpanId = response.details?.id;
    if (!backendSpanId) {
      throw new Error('Prefactor span create response did not include details.id');
    }

    this.externalToBackendSpanIds.set(span.externalSpanId, backendSpanId);
    return backendSpanId;
  }

  async finishInstance(
    agentInstanceId: string,
    status: 'complete' | 'failed' | 'cancelled' = 'complete'
  ): Promise<void> {
    await this.agentInstances.finish(agentInstanceId, { status });
  }
}
