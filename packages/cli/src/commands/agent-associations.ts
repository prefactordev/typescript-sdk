import { type Command, Option } from 'commander';
import {
  AgentAssociationClient,
  type AgentAssociationForCreate,
  type AgentAssociationTrigger,
} from '../clients/agent-association.js';
import {
  executeAuthed,
  listParamsFromOptions,
  parseIdList,
  parsePaginationOffset,
  parsePositiveInt,
  printJson,
  validateOptionalPfid,
} from './shared.js';

interface ListOptions {
  sort_field?: 'id';
  sort_direction?: 'asc' | 'desc';
  pagination_offset?: number;
  pagination_page_size?: number;
}

function addListOptions(command: Command): Command {
  return command
    .addOption(new Option('--sort_field <field>', 'Sort field').choices(['id']))
    .addOption(
      new Option('--sort_direction <direction>', 'Sort direction').choices(['asc', 'desc'])
    )
    .option('--pagination_offset <pagination_offset>', 'Pagination offset', parsePaginationOffset)
    .option(
      '--pagination_page_size <pagination_page_size>',
      'Pagination page size',
      parsePositiveInt
    );
}

/** Register commands that link a judge to the agent it scores. */
export function registerAgentAssociationsCommands(program: Command): void {
  const associations = program
    .command('agent_associations')
    .description('Manage associations between a judge and an agent');

  addListOptions(
    associations
      .command('list_from')
      .description('List associations from judges')
      .requiredOption('--agent_ids <ids>', 'Comma-separated judge agent IDs')
  ).action(function (this: Command, options: ListOptions & { agent_ids: string }) {
    return executeAuthed(this, async (apiClient) => {
      printJson(
        await new AgentAssociationClient(apiClient).listFrom({
          agent_ids: parseIdList(options.agent_ids, '--agent_ids'),
          ...listParamsFromOptions(options),
        })
      );
    });
  });

  addListOptions(
    associations
      .command('list_to')
      .description('List associations to an agent')
      .requiredOption('--agent_id <agent_id>', 'Agent ID')
  ).action(function (this: Command, options: ListOptions & { agent_id: string }) {
    return executeAuthed(this, async (apiClient) => {
      printJson(
        await new AgentAssociationClient(apiClient).listTo({
          agent_id: options.agent_id,
          ...listParamsFromOptions(options),
        })
      );
    });
  });

  associations
    .command('retrieve <id>')
    .description('Retrieve an agent association')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new AgentAssociationClient(apiClient).retrieve(id));
      });
    });

  associations
    .command('create')
    .description('Create an agent association')
    .requiredOption('--from_agent_id <from_agent_id>', 'Judge agent ID')
    .requiredOption('--to_agent_id <to_agent_id>', 'Agent the judge scores')
    .requiredOption('--association_type <association_type>', 'Association type')
    .addOption(
      new Option('--trigger <trigger>', 'When the judge runs')
        .choices(['on_demand', 'on_completion'])
        .makeOptionMandatory()
    )
    .option('--id <id>', 'Association ID')
    .action(function (
      this: Command,
      options: {
        from_agent_id: string;
        to_agent_id: string;
        association_type: string;
        trigger: AgentAssociationTrigger;
        id?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');
        const details: AgentAssociationForCreate = {
          from_agent_id: options.from_agent_id,
          to_agent_id: options.to_agent_id,
          association_type: options.association_type,
          trigger: options.trigger,
          ...(options.id ? { id: options.id } : {}),
        };
        printJson(await new AgentAssociationClient(apiClient).create(details));
      });
    });

  associations
    .command('update <id>')
    .description('Update an agent association trigger')
    .addOption(
      new Option('--trigger <trigger>', 'When the judge runs')
        .choices(['on_demand', 'on_completion'])
        .makeOptionMandatory()
    )
    .action(function (this: Command, id: string, options: { trigger: AgentAssociationTrigger }) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new AgentAssociationClient(apiClient).update(id, options.trigger));
      });
    });

  associations
    .command('delete <id>')
    .description('Delete an agent association')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new AgentAssociationClient(apiClient).delete(id));
      });
    });
}
