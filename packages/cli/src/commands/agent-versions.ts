import { type Command, Option } from 'commander';
import { AgentVersionClient } from '../clients/agent-version.js';
import { executeAuthed, printJson } from './shared.js';

export function registerAgentVersionsCommands(program: Command): void {
  const agentVersions = program.command('agent_versions').description('Manage agent versions');

  agentVersions
    .command('list')
    .description('List agent versions')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .action(function (this: Command, options: { agent_id: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentVersionClient(apiClient).list(options.agent_id);
        printJson(result);
      });
    });

  agentVersions
    .command('retrieve <id>')
    .description('Retrieve agent version')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentVersionClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  agentVersions
    .command('create')
    .description('Create agent version')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .requiredOption('--external_identifier <external_identifier>', 'External identifier')
    .option('--agent_schema_version_id <agent_schema_version_id>', 'Agent schema version ID')
    .addOption(
      new Option('--execution_mode <mode>', 'Where this version runs').choices(['hosted', 'remote'])
    )
    .action(function (
      this: Command,
      options: {
        agent_id: string;
        external_identifier: string;
        agent_schema_version_id?: string;
        execution_mode?: 'hosted' | 'remote';
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentVersionClient(apiClient).create(
          options.agent_id,
          options.external_identifier,
          {
            ...(options.agent_schema_version_id
              ? { agent_schema_version_id: options.agent_schema_version_id }
              : {}),
            ...(options.execution_mode ? { execution_mode: options.execution_mode } : {}),
          }
        );
        printJson(result);
      });
    });
}
