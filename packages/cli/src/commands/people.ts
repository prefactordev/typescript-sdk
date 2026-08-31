import type { Command } from 'commander';
import {
  PersonClient,
  type PersonForCreate,
  type PersonForUpdate,
  type PersonListParams,
} from '../clients/person.js';
import {
  executeAuthed,
  parseJsonOption,
  parsePaginationOffset,
  parsePositiveInt,
  printJson,
  validateOptionalPfid,
} from './shared.js';

async function parseTeamIds(value: string): Promise<string[]> {
  const parsed = await parseJsonOption<unknown[]>(value, '--team_ids', 'array');
  if (!parsed.every((item): item is string => typeof item === 'string')) {
    throw new Error('--team_ids must be a JSON array of strings.');
  }
  return parsed;
}

export function registerPeopleCommands(program: Command): void {
  const people = program.command('people').description('Manage people');

  people
    .command('list')
    .description('List people')
    .option('--team_id <team_id>', 'Team ID')
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
        team_id?: string;
        sorting?: string;
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const params: PersonListParams = {
          ...(options.team_id ? { team_id: options.team_id } : {}),
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
        const result = await new PersonClient(apiClient).list(params);
        printJson(result);
      });
    });

  people
    .command('retrieve <id>')
    .description('Retrieve person')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new PersonClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  people
    .command('create')
    .description('Create person')
    .requiredOption('--email <email>', 'Email')
    .requiredOption('--name <name>', 'Name')
    .option('--id <id>', 'Person ID')
    .option('--team_ids <team_ids>', 'JSON array of team IDs or @file')
    .option('--title <title>', 'Job title')
    .action(function (
      this: Command,
      options: {
        email: string;
        name: string;
        id?: string;
        team_ids?: string;
        title?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');

        const details: PersonForCreate = {
          email: options.email,
          name: options.name,
          ...(options.id ? { id: options.id } : {}),
          ...(options.team_ids ? { team_ids: await parseTeamIds(options.team_ids) } : {}),
          ...(options.title ? { title: options.title } : {}),
        };
        const result = await new PersonClient(apiClient).create(details);
        printJson(result);
      });
    });

  people
    .command('update <id>')
    .description('Update person')
    .option('--email <email>', 'Email')
    .option('--name <name>', 'Name')
    .option('--team_ids <team_ids>', 'JSON array of team IDs or @file')
    .option('--title <title>', 'Job title')
    .action(function (
      this: Command,
      id: string,
      options: {
        email?: string;
        name?: string;
        team_ids?: string;
        title?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        if (
          options.email === undefined &&
          options.name === undefined &&
          options.team_ids === undefined &&
          options.title === undefined
        ) {
          throw new Error(
            'No fields provided to update. Specify --email, --name, --team_ids, or --title.'
          );
        }

        const details: PersonForUpdate = {
          ...(options.email !== undefined ? { email: options.email } : {}),
          ...(options.name !== undefined ? { name: options.name } : {}),
          ...(options.team_ids !== undefined
            ? { team_ids: await parseTeamIds(options.team_ids) }
            : {}),
          ...(options.title !== undefined ? { title: options.title } : {}),
        };
        const result = await new PersonClient(apiClient).update(id, details);
        printJson(result);
      });
    });

  people
    .command('delete <id>')
    .description('Delete person')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new PersonClient(apiClient).delete(id);
        printJson(result);
      });
    });
}
