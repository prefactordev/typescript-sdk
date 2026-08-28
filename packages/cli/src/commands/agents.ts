import type { Command } from 'commander';
import { AgentClient } from '../clients/agent.js';
import { executeAuthed, printJson, validateOptionalPfid } from './shared.js';

export function registerAgentsCommands(program: Command): void {
  const agents = program.command('agents').description('Manage agents');

  agents
    .command('list')
    .description('List agents')
    .action(function (this: Command) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentClient(apiClient).list();
        printJson(result);
      });
    });

  agents
    .command('retrieve <id>')
    .description('Retrieve agent')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  agents
    .command('show')
    .description('Show agent by id or external identifier')
    .option('--agent_id <agent_id>', 'Agent ID')
    .option('--external_identifier <external_identifier>', 'External identifier')
    .option('--environment_id <environment_id>', 'Environment ID')
    .option('--include_counts', 'Include instance counts')
    .option('--include_risk_rollup', 'Include risk rollup')
    .action(function (
      this: Command,
      options: {
        agent_id?: string;
        external_identifier?: string;
        environment_id?: string;
        include_counts?: boolean;
        include_risk_rollup?: boolean;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        if (!options.agent_id && !options.external_identifier) {
          throw new Error('Specify --agent_id or --external_identifier.');
        }

        const result = await new AgentClient(apiClient).show({
          ...(options.agent_id ? { agent_id: options.agent_id } : {}),
          ...(options.external_identifier
            ? { external_identifier: options.external_identifier }
            : {}),
          ...(options.environment_id ? { environment_id: options.environment_id } : {}),
          ...(options.include_counts ? { include_counts: true } : {}),
          ...(options.include_risk_rollup ? { include_risk_rollup: true } : {}),
        });
        printJson(result);
      });
    });

  agents
    .command('create')
    .description('Create agent')
    .requiredOption('--name <name>', 'Agent name')
    .option('--description <description>', 'Agent description')
    .option('--id <id>', 'Agent ID')
    .action(function (
      this: Command,
      options: {
        name: string;
        description?: string;
        id?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');

        const result = await new AgentClient(apiClient).create({
          name: options.name,
          ...(options.description ? { description: options.description } : {}),
          ...(options.id ? { id: options.id } : {}),
        });
        printJson(result);
      });
    });

  agents
    .command('update <id>')
    .description('Update agent')
    .option('--name <name>', 'Agent name')
    .option('--description <description>', 'Agent description')
    .action(function (this: Command, id: string, options: { name?: string; description?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentClient(apiClient).update(id, {
          ...(options.name ? { name: options.name } : {}),
          ...(options.description ? { description: options.description } : {}),
        });
        printJson(result);
      });
    });

  agents
    .command('delete <id>')
    .description('Delete agent')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        await new AgentClient(apiClient).delete(id);
        printJson({ ok: true });
      });
    });

  agents
    .command('retire <id>')
    .description('Retire agent')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentClient(apiClient).retire(id);
        printJson(result);
      });
    });

  agents
    .command('reinstate <id>')
    .description('Reinstate agent')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentClient(apiClient).reinstate(id);
        printJson(result);
      });
    });
}
