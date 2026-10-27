import { type Command, Option } from 'commander';
import { AgentInstanceAssociationClient } from '../clients/agent-instance-association.js';
import {
  executeAuthed,
  listParamsFromOptions,
  parseIdList,
  parsePaginationOffset,
  parsePositiveInt,
  printJson,
} from './shared.js';

/** Register commands that read associations between agent instances. */
export function registerAgentInstanceAssociationsCommands(program: Command): void {
  const associations = program
    .command('agent_instance_associations')
    .description('Read associations between agent instances');

  associations
    .command('list_from')
    .description('List associations from agent instances')
    .requiredOption(
      '--agent_instance_ids <ids>',
      'Comma-separated agent instance IDs (the judge runs)'
    )
    .addOption(new Option('--sort_field <field>', 'Sort field').choices(['id']))
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
        agent_instance_ids: string;
        sort_field?: 'id';
        sort_direction?: 'asc' | 'desc';
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new AgentInstanceAssociationClient(apiClient).listFrom({
            agent_instance_ids: parseIdList(options.agent_instance_ids, '--agent_instance_ids'),
            ...listParamsFromOptions(options),
          })
        );
      });
    });

  associations
    .command('list_to')
    .description('List associations to an agent instance')
    .requiredOption('--agent_instance_id <agent_instance_id>', 'Judged agent instance ID')
    .addOption(new Option('--sort_field <field>', 'Sort field').choices(['id']))
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
        agent_instance_id: string;
        sort_field?: 'id';
        sort_direction?: 'asc' | 'desc';
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new AgentInstanceAssociationClient(apiClient).listTo({
            agent_instance_id: options.agent_instance_id,
            ...listParamsFromOptions(options),
          })
        );
      });
    });

  associations
    .command('retrieve <id>')
    .description('Retrieve an agent instance association')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new AgentInstanceAssociationClient(apiClient).retrieve(id));
      });
    });
}
