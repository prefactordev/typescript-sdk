import type { Command } from 'commander';
import { TeamClient, type TeamForCreate, type TeamListParams } from '../clients/team.js';
import { executeAuthed, parsePositiveInt, printJson, validateOptionalPfid } from './shared.js';

function parsePaginationOffset(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('--pagination_offset must be a non-negative integer.');
  }
  return parsed;
}

export function registerTeamsCommands(program: Command): void {
  const teams = program.command('teams').description('Manage teams');

  teams
    .command('list')
    .description('List teams')
    .option('--sorting <sorting>', 'Sorting')
    .option('--pagination_offset <pagination_offset>', 'Pagination offset', parsePaginationOffset)
    .option(
      '--pagination_page_size <pagination_page_size>',
      'Pagination page size',
      parsePositiveInt
    )
    .action(function (
      this: Command,
      options: {
        sorting?: string;
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const params: TeamListParams = {
          ...(options.sorting ? { sorting: options.sorting } : {}),
          ...(options.pagination_offset !== undefined || options.pagination_page_size !== undefined
            ? {
                pagination: {
                  ...(options.pagination_offset !== undefined
                    ? { offset: options.pagination_offset }
                    : {}),
                  ...(options.pagination_page_size !== undefined
                    ? { page_size: options.pagination_page_size }
                    : {}),
                },
              }
            : {}),
        };
        const result = await new TeamClient(apiClient).list(params);
        printJson(result);
      });
    });

  teams
    .command('retrieve <id>')
    .description('Retrieve team')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new TeamClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  teams
    .command('create')
    .description('Create team')
    .requiredOption('--name <name>', 'Team name')
    .option('--id <id>', 'Team ID')
    .action(function (this: Command, options: { name: string; id?: string }) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');

        const details: TeamForCreate = {
          name: options.name,
          ...(options.id ? { id: options.id } : {}),
        };
        const result = await new TeamClient(apiClient).create(details);
        printJson(result);
      });
    });

  teams
    .command('update <id>')
    .description('Update team')
    .option('--name <name>', 'Team name')
    .action(function (this: Command, id: string, options: { name?: string }) {
      return executeAuthed(this, async (apiClient) => {
        if (options.name === undefined) {
          throw new Error('No fields provided to update. Specify --name.');
        }

        const result = await new TeamClient(apiClient).update(id, { name: options.name });
        printJson(result);
      });
    });

  teams
    .command('delete <id>')
    .description('Delete team')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new TeamClient(apiClient).delete(id);
        printJson(result);
      });
    });
}
