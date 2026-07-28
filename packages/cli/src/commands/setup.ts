import type { Command } from 'commander';
import { ApiClient } from '../api-client.js';
import { AccountClient } from '../clients/account.js';
import { AgentClient } from '../clients/agent.js';
import { AgentDeploymentClient } from '../clients/agent-deployment.js';
import { ApiTokenClient } from '../clients/api-token.js';
import { EnvironmentClient } from '../clients/environment.js';
import { getAuthedContext } from './shared.js';

const DEFAULT_AGENT_IDENTIFIER = '1.0.0';
const EXPECTED_TOKEN_TYPE = 'api_session_agent_deployment_scope';

type SetupOptions = {
  create?: boolean;
  name?: string;
  description?: string;
  json?: boolean;
};

type SetupValues = {
  api_url: string;
  api_token: string;
  agent_id: string;
  agent_identifier: string;
};

type PingDetails = {
  token_type?: string;
  agent_id?: string;
};

type PingResponse = {
  status?: string;
  details?: PingDetails;
};

export function registerSetupCommand(program: Command): void {
  program
    .command('setup [agent_id]')
    .description('Create setup values for an agent (optionally create the agent first)')
    .option('--create', 'Create a new agent before printing setup values')
    .option('--name <name>', 'Agent name (required with --create)')
    .option('--description <description>', 'Agent description (optional with --create)')
    .option('--json', 'Print setup values as JSON')
    .action(async function (this: Command, agentIdArg: string | undefined, options: SetupOptions) {
      const { apiClient, baseUrl } = await getAuthedContext(this);
      const agentId = await resolveAgentId(apiClient, agentIdArg, options);
      await new AgentClient(apiClient).retrieve(agentId);

      const environmentId = await resolveEnvironmentId(apiClient, agentId);
      const tokenResponse = await new ApiTokenClient(apiClient).create({
        token_scope: 'agent_deployment',
        agent_id: agentId,
        environment_id: environmentId,
      });
      const apiToken = tokenResponse.details.token;

      await validateSetupToken(baseUrl, apiToken, agentId);

      const values: SetupValues = {
        api_url: baseUrl,
        api_token: apiToken,
        agent_id: agentId,
        agent_identifier: DEFAULT_AGENT_IDENTIFIER,
      };

      printSetupValues(values, options.json === true);
    });
}

/**
 * Prints setup values for capture by a human or coding tool.
 * The deployment token is intentional CLI output, not application logging.
 */
function printSetupValues(values: SetupValues, asJson: boolean): void {
  if (asJson) {
    // codeql[js/clear-text-logging] Intentional: setup prints the deployment token for the caller to capture.
    process.stdout.write(`${JSON.stringify(values, null, 2)}\n`);
    return;
  }

  process.stdout.write(`PREFACTOR_API_URL=${values.api_url}\n`);
  // codeql[js/clear-text-logging] Intentional: setup prints the deployment token for the caller to capture.
  process.stdout.write(`PREFACTOR_API_TOKEN=${values.api_token}\n`);
  process.stdout.write(`PREFACTOR_AGENT_ID=${values.agent_id}\n`);
  process.stdout.write(`PREFACTOR_AGENT_IDENTIFIER=${values.agent_identifier}\n`);
}

async function resolveAgentId(
  apiClient: ApiClient,
  agentIdArg: string | undefined,
  options: SetupOptions
): Promise<string> {
  if (options.create) {
    const name = options.name?.trim();
    if (!name) {
      throw new Error("prefactor setup --create requires --name '<agent-name>'.");
    }

    if (agentIdArg) {
      throw new Error('prefactor setup --create does not accept an agent_id argument.');
    }

    const description = options.description?.trim();
    const created = await new AgentClient(apiClient).create({
      name,
      ...(description ? { description } : {}),
    });
    return created.details.id;
  }

  if (!agentIdArg) {
    throw new Error(
      "prefactor setup requires <agent_id>, or --create --name '<agent-name>' to create one."
    );
  }

  if (options.name) {
    throw new Error('--name is only valid with --create.');
  }

  if (options.description) {
    throw new Error('--description is only valid with --create.');
  }

  return agentIdArg;
}

async function validateSetupToken(
  baseUrl: string,
  apiToken: string,
  agentId: string
): Promise<void> {
  const pingClient = new ApiClient(baseUrl, apiToken);
  const ping = await pingClient.request<PingResponse>('/ping', { method: 'GET' });

  if (ping.status !== 'success') {
    throw new Error(
      `Setup token ping failed: expected status "success", got ${JSON.stringify(ping.status)}.`
    );
  }

  const tokenType = ping.details?.token_type;
  if (tokenType !== EXPECTED_TOKEN_TYPE) {
    throw new Error(
      `Setup token ping failed: expected token_type "${EXPECTED_TOKEN_TYPE}", got ${JSON.stringify(tokenType)}.`
    );
  }

  const pingAgentId = ping.details?.agent_id;
  if (pingAgentId !== agentId) {
    throw new Error(
      `Setup token ping failed: expected agent_id "${agentId}", got ${JSON.stringify(pingAgentId)}.`
    );
  }
}

async function resolveEnvironmentId(apiClient: ApiClient, agentId: string): Promise<string> {
  const deploymentResponse = await new AgentDeploymentClient(apiClient).list(agentId);
  const deployments = getListItems(deploymentResponse);

  if (deployments.length === 0) {
    return resolveEnvironmentIdFromAccount(apiClient);
  }

  if (deployments.length === 1) {
    return deployments[0].environment_id;
  }

  const deploymentsWithCurrentVersion = deployments.filter(
    (deployment) => deployment.current_version_id !== null
  );

  if (deploymentsWithCurrentVersion.length === 1) {
    return deploymentsWithCurrentVersion[0].environment_id;
  }

  throw new Error(
    `Unable to choose an agent deployment for '${agentId}'. Expected one deployment, or one deployment with current_version_id.`
  );
}

async function resolveEnvironmentIdFromAccount(apiClient: ApiClient): Promise<string> {
  const accountResponse = await new AccountClient(apiClient).list();
  const accounts = getListItems(accountResponse);

  if (accounts.length === 0) {
    throw new Error('No accounts accessible to this profile; cannot create a deployment token.');
  }

  const account = accounts[0];
  const environmentResponse = await new EnvironmentClient(apiClient).list(account.id);
  const environments = getListItems(environmentResponse);

  if (environments.length === 0) {
    throw new Error(`No environments found for account ${account.id}; create one first.`);
  }

  return environments[0].id;
}

function getListItems<T>(response: { details?: T[]; summaries?: T[] }): T[] {
  return response.details ?? response.summaries ?? [];
}
