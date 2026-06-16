import type { Command } from 'commander';
import type { ApiClient } from '../api-client.js';
import { AgentClient } from '../clients/agent.js';
import { type AgentDeployment, AgentDeploymentClient } from '../clients/agent-deployment.js';
import { ApiTokenClient } from '../clients/api-token.js';
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
      console.log(`PREFACTOR_API_TOKEN=${tokenResponse.token}`);
      console.log(`PREFACTOR_AGENT_ID=${agentId}`);
      console.log(`PREFACTOR_AGENT_IDENTIFIER=${DEFAULT_AGENT_IDENTIFIER}`);
    });
}

async function resolveAgentDeployment(
  apiClient: ApiClient,
  agentId: string
): Promise<AgentDeployment> {
  const deploymentResponse = await new AgentDeploymentClient(apiClient).list(agentId);
  const deployments = getDeployments(deploymentResponse);

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

function getDeployments(response: { details?: AgentDeployment[]; summaries?: AgentDeployment[] }) {
  return response.details ?? response.summaries ?? [];
}
