import type { Command } from 'commander';
import { AgentClient } from '../clients/agent.js';
import { executeAuthed, printJson, validateOptionalPfid } from './shared.js';

export function registerAgentsCommands(program: Command): void {
  const agents = program.command('agents').description('Manage agents');

  agents
    .command('list')
    .description('List agents')
    .requiredOption('--environment_id <environment_id>', 'Environment ID')
    .action(function (this: Command, options: { environment_id: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentClient(apiClient).list(options.environment_id);
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
    .command('create')
    .description('Create agent')
    .requiredOption('--name <name>', 'Agent name')
    .requiredOption('--environment_id <environment_id>', 'Environment ID')
    .option('--description <description>', 'Agent description')
    .option('--id <id>', 'Agent ID')
    .action(function (
      this: Command,
      options: {
        name: string;
        environment_id: string;
        description?: string;
        id?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');

        const result = await new AgentClient(apiClient).create({
          name: options.name,
          environment_id: options.environment_id,
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
    .option('--current_version_id <current_version_id>', 'Current version ID')
    .action(function (
      this: Command,
      id: string,
      options: { name?: string; description?: string; current_version_id?: string }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentClient(apiClient).update(id, {
          ...(options.name ? { name: options.name } : {}),
          ...(options.description ? { description: options.description } : {}),
          ...(options.current_version_id ? { current_version_id: options.current_version_id } : {}),
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
