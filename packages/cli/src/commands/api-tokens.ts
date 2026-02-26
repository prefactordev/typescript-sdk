import type { Command } from 'commander';
import { ApiTokenClient } from '../clients/api-token.js';
import {
  executeAuthed,
  printJson,
  validateTokenCreateOptions,
  validateTokenScope,
} from './shared.js';

export function registerApiTokensCommands(program: Command): void {
  const apiTokens = program.command('api_tokens').description('Manage API tokens');

  apiTokens
    .command('list')
    .description('List API tokens')
    .option('--account_id <account_id>', 'Account ID')
    .action(function (this: Command, options: { account_id?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new ApiTokenClient(apiClient).list(options.account_id);
        printJson(result);
      });
    });

  apiTokens
    .command('retrieve <id>')
    .description('Retrieve API token')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new ApiTokenClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  apiTokens
    .command('create')
    .description('Create API token')
    .requiredOption('--token_scope <token_scope>', 'Token scope')
    .option('--account_id <account_id>', 'Account ID')
    .option('--environment_id <environment_id>', 'Environment ID')
    .option('--expires_at <expires_at>', 'Expiration timestamp')
    .action(function (
      this: Command,
      options: {
        token_scope: string;
        account_id?: string;
        environment_id?: string;
        expires_at?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateTokenScope(options.token_scope);
        validateTokenCreateOptions(options.token_scope, options.environment_id);

        const result = await new ApiTokenClient(apiClient).create({
          token_scope: options.token_scope,
          ...(options.account_id ? { account_id: options.account_id } : {}),
          ...(options.environment_id ? { environment_id: options.environment_id } : {}),
          ...(options.expires_at ? { expires_at: options.expires_at } : {}),
        });
        printJson(result);
      });
    });

  apiTokens
    .command('suspend <id>')
    .description('Suspend API token')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new ApiTokenClient(apiClient).suspend(id);
        printJson(result);
      });
    });

  apiTokens
    .command('activate <id>')
    .description('Activate API token')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new ApiTokenClient(apiClient).activate(id);
        printJson(result);
      });
    });

  apiTokens
    .command('revoke <id>')
    .description('Revoke API token')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new ApiTokenClient(apiClient).revoke(id);
        printJson(result);
      });
    });

  apiTokens
    .command('delete <id>')
    .description('Delete API token')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        await new ApiTokenClient(apiClient).delete(id);
        printJson({ ok: true });
      });
    });
}
