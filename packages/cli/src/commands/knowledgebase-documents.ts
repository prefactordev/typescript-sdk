import { type Command, Option } from 'commander';
import type { KnowledgebaseStatus } from '../clients/knowledgebase.js';
import {
  KnowledgebaseDocumentClient,
  type KnowledgebaseDocumentForCreate,
  type KnowledgebaseDocumentForUpdate,
  type KnowledgebaseDocumentListParams,
} from '../clients/knowledgebase-document.js';
import {
  executeAuthed,
  listParamsFromOptions,
  parsePaginationOffset,
  parsePositiveInt,
  printDocumentContent,
  printJson,
  readTextOption,
} from './shared.js';

const STATUS_CHOICES = ['active', 'archived'] as const;
const SORT_FIELDS = ['id', 'path'] as const;

/** Register knowledgebase document commands. */
export function registerKnowledgebaseDocumentsCommands(program: Command): void {
  const documents = program
    .command('knowledgebase_documents')
    .description('Manage knowledgebase documents');

  documents
    .command('list')
    .description('List documents in a knowledgebase')
    .requiredOption('--knowledgebase_id <knowledgebase_id>', 'Knowledgebase ID')
    .option('--path_prefix <path_prefix>', 'Only documents whose path starts with this prefix')
    .addOption(new Option('--status <status>', 'Document status').choices([...STATUS_CHOICES]))
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
        knowledgebase_id: string;
        path_prefix?: string;
        status?: KnowledgebaseStatus;
        sort_field?: 'id' | 'path';
        sort_direction?: 'asc' | 'desc';
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const params: KnowledgebaseDocumentListParams = {
          knowledgebase_id: options.knowledgebase_id,
          ...(options.path_prefix !== undefined ? { path_prefix: options.path_prefix } : {}),
          ...(options.status !== undefined ? { status: options.status } : {}),
          ...listParamsFromOptions(options),
        };
        printJson(await new KnowledgebaseDocumentClient(apiClient).list(params));
      });
    });

  documents
    .command('retrieve <id>')
    .description('Retrieve a document')
    .option('--content_only', 'Print document content without the JSON envelope')
    .action(function (this: Command, id: string, options: { content_only?: boolean }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new KnowledgebaseDocumentClient(apiClient).retrieve(id);
        if (options.content_only) {
          printDocumentContent(result);
          return;
        }
        printJson(result);
      });
    });

  documents
    .command('create')
    .description('Create a document')
    .requiredOption('--knowledgebase_id <knowledgebase_id>', 'Knowledgebase ID')
    .requiredOption('--path <path>', 'Document path')
    .requiredOption('--content <content>', 'Document content, or @path to read a text file')
    .option('--content_type <content_type>', 'MIME content type')
    .action(function (
      this: Command,
      options: {
        knowledgebase_id: string;
        path: string;
        content: string;
        content_type?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const details: KnowledgebaseDocumentForCreate = {
          knowledgebase_id: options.knowledgebase_id,
          path: options.path,
          content: await readTextOption(options.content, '--content'),
          ...(options.content_type !== undefined ? { content_type: options.content_type } : {}),
        };
        printJson(await new KnowledgebaseDocumentClient(apiClient).create(details));
      });
    });

  documents
    .command('update <id>')
    .description('Update document content')
    .requiredOption('--base_revision_id <id>', 'Document revision this change is based on')
    .option('--content <content>', 'Document content, or @path to read a text file')
    .option('--content_type <content_type>', 'MIME content type')
    .action(function (
      this: Command,
      id: string,
      options: { base_revision_id: string; content?: string; content_type?: string }
    ) {
      return executeAuthed(this, async (apiClient) => {
        if (options.content === undefined && options.content_type === undefined) {
          throw new Error('No fields provided to update. Specify --content or --content_type.');
        }

        const details: KnowledgebaseDocumentForUpdate = {};
        if (options.content !== undefined) {
          details.content = await readTextOption(options.content, '--content');
        }
        if (options.content_type !== undefined) {
          details.content_type = options.content_type;
        }

        printJson(
          await new KnowledgebaseDocumentClient(apiClient).update(id, {
            base_revision_id: options.base_revision_id,
            details,
          })
        );
      });
    });

  documents
    .command('rename <id>')
    .description('Rename a document')
    .requiredOption('--base_revision_id <id>', 'Document revision this change is based on')
    .requiredOption('--path <path>', 'New document path')
    .action(function (
      this: Command,
      id: string,
      options: { base_revision_id: string; path: string }
    ) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new KnowledgebaseDocumentClient(apiClient).rename(id, {
            base_revision_id: options.base_revision_id,
            path: options.path,
          })
        );
      });
    });

  documents
    .command('archive <id>')
    .description('Archive a document')
    .requiredOption('--base_revision_id <id>', 'Document revision this change is based on')
    .action(function (this: Command, id: string, options: { base_revision_id: string }) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new KnowledgebaseDocumentClient(apiClient).archive(id, {
            base_revision_id: options.base_revision_id,
          })
        );
      });
    });

  documents
    .command('unarchive <id>')
    .description('Unarchive a document')
    .requiredOption('--base_revision_id <id>', 'Document revision this change is based on')
    .option('--path <path>', 'Path to restore the document to')
    .action(function (
      this: Command,
      id: string,
      options: { base_revision_id: string; path?: string }
    ) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new KnowledgebaseDocumentClient(apiClient).unarchive(id, {
            base_revision_id: options.base_revision_id,
            ...(options.path !== undefined ? { path: options.path } : {}),
          })
        );
      });
    });

  documents
    .command('delete <id>')
    .description('Delete a document')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new KnowledgebaseDocumentClient(apiClient).delete(id));
      });
    });
}
