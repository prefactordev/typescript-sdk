import { type Command, Option } from 'commander';
import {
  KnowledgebaseClient,
  type KnowledgebaseForCreate,
  type KnowledgebaseForUpdate,
  type KnowledgebaseListParams,
  type KnowledgebaseStatus,
} from '../clients/knowledgebase.js';
import {
  executeAuthed,
  listParamsFromOptions,
  parsePaginationOffset,
  parsePositiveInt,
  printJson,
} from './shared.js';

const STATUS_CHOICES = ['active', 'archived'] as const;
const SORT_FIELDS = ['id', 'name'] as const;

/** Register knowledgebase commands. */
export function registerKnowledgebasesCommands(program: Command): void {
  const knowledgebases = program.command('knowledgebases').description('Manage knowledgebases');

  knowledgebases
    .command('list')
    .description('List knowledgebases')
    .option('--account_id <account_id>', 'Account ID')
    .addOption(new Option('--status <status>', 'Knowledgebase status').choices([...STATUS_CHOICES]))
    .addOption(new Option('--sort_field <field>', 'Sort field').choices([...SORT_FIELDS]))
    .addOption(
      new Option('--sort_direction <direction>', 'Sort direction').choices(['asc', 'desc'])
    )
    .option('--pagination_offset <pagination_offset>', 'Pagination offset', parsePaginationOffset)
    .option(
      '--pagination_page_size <pagination_page_size>',
      'Pagination page size',
      parsePositiveInt
    )
    .action(function (
      this: Command,
      options: {
        account_id?: string;
        status?: KnowledgebaseStatus;
        sort_field?: 'id' | 'name';
        sort_direction?: 'asc' | 'desc';
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const params: KnowledgebaseListParams = {
          ...(options.account_id !== undefined ? { account_id: options.account_id } : {}),
          ...(options.status !== undefined ? { status: options.status } : {}),
          ...listParamsFromOptions(options),
        };
        printJson(await new KnowledgebaseClient(apiClient).list(params));
      });
    });

  knowledgebases
    .command('retrieve <id>')
    .description('Retrieve a knowledgebase')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new KnowledgebaseClient(apiClient).retrieve(id));
      });
    });

  knowledgebases
    .command('create')
    .description('Create a knowledgebase')
    .requiredOption('--name <name>', 'Knowledgebase name')
    .option('--account_id <account_id>', 'Account ID')
    .option('--description <description>', 'Knowledgebase description')
    .action(function (
      this: Command,
      options: { name: string; account_id?: string; description?: string }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const details: KnowledgebaseForCreate = {
          name: options.name,
          ...(options.account_id !== undefined ? { account_id: options.account_id } : {}),
          ...(options.description !== undefined ? { description: options.description } : {}),
        };
        printJson(await new KnowledgebaseClient(apiClient).create(details));
      });
    });

  knowledgebases
    .command('update <id>')
    .description('Update a knowledgebase')
    .option('--name <name>', 'Knowledgebase name')
    .option('--description <description>', 'Knowledgebase description')
    .option('--clear_description', 'Clear the description')
    .action(function (
      this: Command,
      id: string,
      options: { name?: string; description?: string; clear_description?: boolean }
    ) {
      return executeAuthed(this, async (apiClient) => {
        if (options.description !== undefined && options.clear_description) {
          throw new Error('Use only one of --description or --clear_description.');
        }
        if (
          options.name === undefined &&
          options.description === undefined &&
          !options.clear_description
        ) {
          throw new Error(
            'No fields provided to update. Specify --name, --description, or --clear_description.'
          );
        }

        const details: KnowledgebaseForUpdate = {};
        if (options.name !== undefined) {
          details.name = options.name;
        }
        if (options.clear_description) {
          details.description = null;
        } else if (options.description !== undefined) {
          details.description = options.description;
        }

        printJson(await new KnowledgebaseClient(apiClient).update(id, details));
      });
    });

  for (const [operation, description] of [
    ['archive', 'Archive a knowledgebase'],
    ['unarchive', 'Unarchive a knowledgebase'],
    ['delete', 'Delete a knowledgebase'],
  ] as const) {
    knowledgebases
      .command(`${operation} <id>`)
      .description(description)
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          printJson(await new KnowledgebaseClient(apiClient)[operation](id));
        });
      });
  }
}
