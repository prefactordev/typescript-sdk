import { type Command, Option } from 'commander';
import {
  AgentAssociationClient,
  type AgentAssociationForCreate,
  type AgentAssociationTrigger,
} from '../clients/agent-association.js';
import {
  executeAuthed,
  listParamsFromOptions,
  parsePaginationOffset,
  parsePositiveInt,
  printJson,
  validateOptionalPfid,
} from './shared.js';

/** Register commands that link a judge to the agent it scores. */
export function registerAgentAssociationsCommands(program: Command): void {
  const associations = program
    .command('agent_associations')
    .description('Manage associations between a judge and an agent');

  for (const [operation, description] of [
    ['list_from', 'List associations from an agent'],
    ['list_to', 'List associations to an agent'],
  ] as const) {
    associations
      .command(operation)
      .description(description)
      .requiredOption('--agent_id <agent_id>', 'Agent ID')
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
          agent_id: string;
          sort_field?: 'id';
          sort_direction?: 'asc' | 'desc';
          pagination_offset?: number;
          pagination_page_size?: number;
        }
      ) {
        return executeAuthed(this, async (apiClient) => {
          const client = new AgentAssociationClient(apiClient);
          const params = { agent_id: options.agent_id, ...listParamsFromOptions(options) };
          printJson(
            await (operation === 'list_from' ? client.listFrom(params) : client.listTo(params))
          );
        });
      });
  }

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
