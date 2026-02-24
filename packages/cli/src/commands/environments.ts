import type { Command } from 'commander';
import { EnvironmentClient } from '../clients/environment.js';
import { executeAuthed, printJson, validateOptionalPfid } from './shared.js';

export function registerEnvironmentsCommands(program: Command): void {
  const environments = program.command('environments').description('Manage environments');

  environments
    .command('list')
    .description('List environments')
    .requiredOption('--account_id <account_id>', 'Account ID')
    .action(function (this: Command, options: { account_id: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new EnvironmentClient(apiClient).list(options.account_id);
        printJson(result);
      });
    });

  environments
    .command('retrieve <id>')
    .description('Retrieve environment')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new EnvironmentClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  environments
    .command('create')
    .description('Create environment')
    .requiredOption('--name <name>', 'Environment name')
    .requiredOption('--account_id <account_id>', 'Account ID')
    .option('--id <id>', 'Environment ID')
    .action(function (this: Command, options: { name: string; account_id: string; id?: string }) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');

        const result = await new EnvironmentClient(apiClient).create({
          name: options.name,
          account_id: options.account_id,
          ...(options.id ? { id: options.id } : {}),
        });
        printJson(result);
      });
    });

  environments
    .command('update <id>')
    .description('Update environment')
    .option('--name <name>', 'Environment name')
    .action(function (this: Command, id: string, options: { name?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new EnvironmentClient(apiClient).update(id, {
          ...(options.name ? { name: options.name } : {}),
        });
        printJson(result);
      });
    });

  environments
    .command('delete <id>')
    .description('Delete environment')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        await new EnvironmentClient(apiClient).delete(id);
        printJson({ ok: true });
      });
    });
}
