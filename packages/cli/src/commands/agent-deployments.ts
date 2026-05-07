import type { Command } from 'commander';
import { AgentDeploymentClient } from '../clients/agent-deployment.js';
import { executeAuthed, printJson, validateOptionalPfid } from './shared.js';

const CLEAR_CURRENT_VERSION_SENTINEL = 'null';

export function registerAgentDeploymentsCommands(program: Command): void {
  const deployments = program.command('agent_deployments').description('Manage agent deployments');

  deployments
    .command('list')
    .description('List agent deployments')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .action(function (this: Command, options: { agent_id: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentDeploymentClient(apiClient).list(options.agent_id);
        printJson(result);
      });
    });

  deployments
    .command('retrieve <id>')
    .description('Retrieve agent deployment')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentDeploymentClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  deployments
    .command('create')
    .description('Create agent deployment')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .requiredOption('--environment_id <environment_id>', 'Environment ID')
    .option('--id <id>', 'Deployment ID')
    .option('--current_version_id <current_version_id>', 'Current agent version ID')
    .action(function (
      this: Command,
      options: {
        agent_id: string;
        environment_id: string;
        id?: string;
        current_version_id?: string;
      }
    ) {
      const deploymentId = options.id?.trim();
      const currentVersionId = options.current_version_id?.trim();

      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(deploymentId, '--id');

        const result = await new AgentDeploymentClient(apiClient).create({
          agent_id: options.agent_id,
          environment_id: options.environment_id,
          ...(deploymentId ? { id: deploymentId } : {}),
          ...(currentVersionId ? { current_version_id: currentVersionId } : {}),
        });
        printJson(result);
      });
    });

  deployments
    .command('update <id>')
    .description('Update agent deployment')
    .option(
      '--current_version_id <current_version_id>',
      `Current agent version ID (${CLEAR_CURRENT_VERSION_SENTINEL} clears the pin)`
    )
    .action(function (this: Command, id: string, options: { current_version_id?: string }) {
      const currentVersionId = options.current_version_id?.trim();
      if (!currentVersionId) {
        throw new Error('No update fields provided; pass --current_version_id.');
      }

      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentDeploymentClient(apiClient).update(id, {
          current_version_id:
            currentVersionId === CLEAR_CURRENT_VERSION_SENTINEL ? null : currentVersionId,
        });
        printJson(result);
      });
    });

  deployments
    .command('delete <id>')
    .description('Delete agent deployment')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentDeploymentClient(apiClient).delete(id);
        printJson(result);
      });
    });
}
