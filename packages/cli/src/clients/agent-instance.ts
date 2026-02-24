export {
  AgentInstanceClient,
  type AgentInstanceFinishOptions,
  type AgentInstanceRegisterPayload as AgentInstanceRegistrationPayload,
  type AgentInstanceResponse,
} from '@prefactor/core';

export interface AgentInstance {
  id: string;
  agent_id: string;
  status: string;
}

export interface AgentInstanceListResponse {
  details: AgentInstance[];
}
