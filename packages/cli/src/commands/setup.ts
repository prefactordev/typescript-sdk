import type { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { AccountClient } from '../clients/account.js';
import { AgentClient } from '../clients/agent.js';
import { type AgentDeployment, AgentDeploymentClient } from '../clients/agent-deployment.js';
import { ApiTokenClient } from '../clients/api-token.js';
import { EnvironmentClient } from '../clients/environment.js';
import { getAuthedContext } from './shared.js';

const DEFAULT_AGENT_IDENTIFIER = '1.0.0';

export function registerSetupCommand(program: Command): void {
  program
    .command('setup <agent_id>')
    .description('Print Prefactor setup values for an agent')
    .action(async function (this: Command, agentId: string) {
      const { apiClient, baseUrl } = await getAuthedContext(this);

      await new AgentClient(apiClient).retrieve(agentId);
      const deployment = await resolveAgentDeployment(apiClient, agentId);
      const tokenResponse = await new ApiTokenClient(apiClient).create({
        token_scope: 'agent_deployment',
        agent_id: agentId,
        environment_id: deployment.environment_id,
      });

      console.log(`PREFACTOR_API_URL=${baseUrl}`);
      console.log(`PREFACTOR_API_TOKEN=${tokenResponse.details.token}`);
      console.log(`PREFACTOR_AGENT_ID=${agentId}`);
      console.log(`PREFACTOR_AGENT_IDENTIFIER=${DEFAULT_AGENT_IDENTIFIER}`);
    });
}

async function resolveAgentDeployment(
  apiClient: ApiClient,
  agentId: string
): Promise<AgentDeployment> {
  const deploymentResponse = await new AgentDeploymentClient(apiClient).list(agentId);
  const deployments = getListItems(deploymentResponse);

  if (deployments.length === 0) {
    return createAgentDeployment(apiClient, agentId);
  }

  if (deployments.length === 1) {
    return deployments[0];
  }

  const deploymentsWithCurrentVersion = deployments.filter(
    (deployment) => deployment.current_version_id !== null
  );

  if (deploymentsWithCurrentVersion.length === 1) {
    return deploymentsWithCurrentVersion[0];
  }

  throw new Error(
    `Unable to choose an agent deployment for '${agentId}'. Expected one deployment, or one deployment with current_version_id.`
  );
}

async function createAgentDeployment(
  apiClient: ApiClient,
  agentId: string
): Promise<AgentDeployment> {
  const accountResponse = await new AccountClient(apiClient).list();
  const accounts = getListItems(accountResponse);

  if (accounts.length === 0) {
    throw new Error('No accounts accessible to this profile; cannot create a deployment.');
  }

  const account = accounts[0];
  const environmentResponse = await new EnvironmentClient(apiClient).list(account.id);
  const environments = getListItems(environmentResponse);

  if (environments.length === 0) {
    throw new Error(`No environments found for account ${account.id}; create one first.`);
  }

  const environment = environments[0];
  const createResponse = await new AgentDeploymentClient(apiClient).create({
    agent_id: agentId,
    environment_id: environment.id,
  });

  console.error(
    `Created agent deployment for agent '${agentId}' in environment '${environment.name}' (${environment.id}) under account '${account.name}' (${account.id}).`
  );

  return createResponse.details;
}

function getListItems<T>(response: { details?: T[]; summaries?: T[] }): T[] {
  return response.details ?? response.summaries ?? [];
}
