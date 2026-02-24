import type { Command } from 'commander';
import { BulkClient } from '../clients/bulk.js';
import { PfidClient } from '../clients/pfid.js';
import { executeAuthed, parseBulkItems, parsePositiveInt, printJson } from './shared.js';

export function registerUtilitiesCommands(program: Command, version: string): void {
  const pfid = program.command('pfid').description('Generate PFIDs');

  pfid
    .command('generate')
    .description('Generate PFIDs')
    .option('--account_id <account_id>', 'Account ID')
    .option('--count <count>', 'Number of IDs to generate', parsePositiveInt)
    .action(function (this: Command, options: { account_id?: string; count?: number }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new PfidClient(apiClient).generate(
          options.count ?? 1,
          options.account_id
        );
        printJson(result);
      });
    });

  const bulk = program.command('bulk').description('Execute bulk API requests');

  bulk
    .command('execute')
    .description('Execute bulk requests')
    .requiredOption('--items <items>', 'JSON array or @file')
    .action(function (this: Command, options: { items: string }) {
      return executeAuthed(this, async (apiClient) => {
        const items = await parseBulkItems(options.items);
        const result = await new BulkClient(apiClient).execute(items);
        printJson(result);
      });
    });

  program
    .command('version')
    .description('Print CLI version')
    .action(() => {
      console.log(version);
    });
}
