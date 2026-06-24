import type { Command } from 'commander';
import { ApiClient } from '../api-client.js';
import { BulkClient } from '../clients/bulk.js';
import { PfidClient } from '../clients/pfid.js';
import { DEFAULT_BASE_URL } from '../profile-manager.js';
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
    .command('ping')
    .description('Verify the selected or supplied API token')
    .option('--api-token <apiToken>', 'API token to verify')
    .option('--api-url <apiUrl>', 'API URL to use with --api-token')
    .action(function (this: Command, options: { apiToken?: string; apiUrl?: string }) {
      if (options.apiToken) {
        const apiUrl = options.apiUrl ?? process.env.PREFACTOR_API_URL ?? DEFAULT_BASE_URL;
        const apiClient = new ApiClient(apiUrl, options.apiToken);

        return apiClient.request('/ping', { method: 'GET' }).then(printJson);
      }

      return executeAuthed(this, async (apiClient) => {
        const result = await apiClient.request('/ping', { method: 'GET' });
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
