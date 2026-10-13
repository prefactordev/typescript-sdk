import type { Command } from 'commander';
import { KnowledgebaseDocumentRevisionClient } from '../clients/knowledgebase-document-revision.js';
import {
  executeAuthed,
  listParamsFromOptions,
  parsePaginationOffset,
  parsePositiveInt,
  printDocumentContent,
  printJson,
} from './shared.js';

/** Register knowledgebase document revision commands. */
export function registerKnowledgebaseDocumentRevisionsCommands(program: Command): void {
  const revisions = program
    .command('knowledgebase_document_revisions')
    .description('Read knowledgebase document revisions');

  revisions
    .command('list')
    .description('List revisions of a document')
    .requiredOption('--knowledgebase_document_id <id>', 'Knowledgebase document ID')
    .option('--pagination_offset <pagination_offset>', 'Pagination offset', parsePaginationOffset)
    .option(
      '--pagination_page_size <pagination_page_size>',
      'Pagination page size',
      parsePositiveInt
    )
    .action(function (
      this: Command,
      options: {
        knowledgebase_document_id: string;
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new KnowledgebaseDocumentRevisionClient(apiClient).list({
            knowledgebase_document_id: options.knowledgebase_document_id,
            ...listParamsFromOptions(options),
          })
        );
      });
    });

  revisions
    .command('retrieve <id>')
    .description('Retrieve a document revision')
    .option('--content_only', 'Print revision content without the JSON envelope')
    .action(function (this: Command, id: string, options: { content_only?: boolean }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new KnowledgebaseDocumentRevisionClient(apiClient).retrieve(id);
        if (options.content_only) {
          printDocumentContent(result);
          return;
        }
        printJson(result);
      });
    });
}
