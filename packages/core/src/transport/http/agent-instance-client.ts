import type { HttpRequester } from './http-client.js';

export type AgentInstanceRegisterPayload = {
  agent_id?: string;
  agent_version?: {
    external_identifier: string;
    name: string;
    description: string;
  };
  agent_schema_version?: Record<string, unknown>;
};

export type AgentInstanceResponse = {
  details?: {
    id?: string;
  };
};

export class AgentInstanceClient {
  constructor(private readonly httpClient: HttpRequester) {}

  register(payload: AgentInstanceRegisterPayload): Promise<AgentInstanceResponse> {
    return this.httpClient.request('/api/v1/agent_instance/register', {
      method: 'POST',
      body: payload,
    });
  }

  async start(agentInstanceId: string): Promise<void> {
    await this.httpClient.request(`/api/v1/agent_instance/${agentInstanceId}/start`, {
      method: 'POST',
      body: {},
    });
  }

  async finish(agentInstanceId: string): Promise<void> {
    await this.httpClient.request(`/api/v1/agent_instance/${agentInstanceId}/finish`, {
      method: 'POST',
      body: {},
    });
  }
}
