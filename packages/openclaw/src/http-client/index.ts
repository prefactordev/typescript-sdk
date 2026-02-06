// Prefactor HTTP Client
// HTTP client for Prefactor API AgentInstance and AgentSpan endpoints

export {
  PrefactorClient,
  PrefactorConfig,
  createClientFromEnv,
} from './client.js';

export {
  PrefactorError,
  PrefactorNetworkError,
  PrefactorTimeoutError,
  PrefactorConfigError,
} from './errors.js';

export type {
  AgentId,
  AgentInstanceId,
  AgentSpanId,
  AccountId,
  AgentVersionId,
  EnvironmentId,
  AgentInstanceStatus,
  AgentSpanStatus,
  AgentVersionForRegister,
  AgentSchemaVersionForRegister,
  AgentInstanceSpanCounts,
  AgentInstanceDetails,
  AgentSpanDetailsForCreate,
  AgentSpanDetails,
  RegisterAgentInstanceRequest,
  StartAgentInstanceRequest,
  FinishAgentInstanceRequest,
  CreateAgentSpanRequest,
  FinishAgentSpanRequestBody,
  FinishAgentSpanRequest,
  SuccessResponse,
  ErrorResponse,
  RegisterAgentInstanceResponse,
  StartAgentInstanceResponse,
  FinishAgentInstanceResponse,
  CreateAgentSpanResponse,
  FinishAgentSpanResponse,
} from './types.js';
