import type { Command } from 'commander';
import { AccountClient } from '../clients/account.js';
import { executeAuthed, printJson } from './shared.js';

export function registerAccountsCommands(program: Command): void {
  const accounts = program.command('accounts').description('Manage accounts');

  accounts
    .command('list')
    .description('List accounts')
    .action(function (this: Command) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AccountClient(apiClient).list();
        printJson(result);
      });
    });

  accounts
    .command('retrieve <id>')
    .description('Retrieve account')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AccountClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  accounts
    .command('update <id>')
    .description('Update account')
    .requiredOption('--name <name>', 'Account name')
    .action(function (this: Command, id: string, options: { name: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AccountClient(apiClient).update(id, { name: options.name });
        printJson(result);
      });
    });
}
