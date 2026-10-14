import type { Command } from 'commander';
import { KnowledgebaseRevisionClient } from '../clients/knowledgebase-revision.js';
import {
  executeAuthed,
  listParamsFromOptions,
  parsePaginationOffset,
  parsePositiveInt,
  printJson,
} from './shared.js';

/** Register knowledgebase revision commands. */
export function registerKnowledgebaseRevisionsCommands(program: Command): void {
  const revisions = program
    .command('knowledgebase_revisions')
    .description('Read knowledgebase revisions');

  revisions
    .command('list')
    .description('List revisions of a knowledgebase')
    .requiredOption('--knowledgebase_id <knowledgebase_id>', 'Knowledgebase ID')
    .option('--pagination_offset <pagination_offset>', 'Pagination offset', parsePaginationOffset)
    .option(
      '--pagination_page_size <pagination_page_size>',
      'Pagination page size',
      parsePositiveInt
    )
    .action(function (
      this: Command,
      options: {
        knowledgebase_id: string;
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new KnowledgebaseRevisionClient(apiClient).list({
            knowledgebase_id: options.knowledgebase_id,
            ...listParamsFromOptions(options),
          })
        );
      });
    });

  revisions
    .command('retrieve <id>')
    .description('Retrieve a knowledgebase revision')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new KnowledgebaseRevisionClient(apiClient).retrieve(id));
      });
    });

  revisions
    .command('list_documents <id>')
    .description('List documents in a knowledgebase revision')
    .option('--path_prefix <path_prefix>', 'Only documents whose path starts with this prefix')
    .option('--pagination_offset <pagination_offset>', 'Pagination offset', parsePaginationOffset)
    .option(
      '--pagination_page_size <pagination_page_size>',
      'Pagination page size',
      parsePositiveInt
    )
    .action(function (
      this: Command,
      id: string,
      options: {
        path_prefix?: string;
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new KnowledgebaseRevisionClient(apiClient).listDocuments(id, {
            ...(options.path_prefix !== undefined ? { path_prefix: options.path_prefix } : {}),
            ...listParamsFromOptions(options),
          })
        );
      });
    });
}
