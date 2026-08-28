import type { Command } from 'commander';
import {
  RiskProfileClient,
  type RiskProfileForCreate,
  type RiskProfileForUpdate,
  type RiskProfileListParams,
  type RiskProfileRuleset,
} from '../clients/risk-profile.js';
import {
  executeAuthed,
  parseJsonOption,
  parsePositiveInt,
  printJson,
  validateOptionalPfid,
} from './shared.js';

function parsePaginationOffset(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('--pagination_offset must be a non-negative integer.');
  }
  return parsed;
}

export function registerRiskProfilesCommands(program: Command): void {
  const riskProfiles = program.command('risk_profiles').description('Manage risk profiles');

  riskProfiles
    .command('list')
    .description('List risk profiles')
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
        const params: RiskProfileListParams = {
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
        const result = await new RiskProfileClient(apiClient).list(params);
        printJson(result);
      });
    });

  riskProfiles
    .command('retrieve <id>')
    .description('Retrieve risk profile')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new RiskProfileClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  riskProfiles
    .command('template')
    .description('Get a risk profile template ruleset')
    .requiredOption('--template_name <template_name>', 'Template name')
    .action(function (this: Command, options: { template_name: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new RiskProfileClient(apiClient).getTemplate(options.template_name);
        printJson(result);
      });
    });

  riskProfiles
    .command('create')
    .description('Create risk profile')
    .requiredOption('--name <name>', 'Risk profile name')
    .requiredOption('--ruleset <ruleset>', 'JSON object or @file')
    .option('--description <description>', 'Description')
    .option('--id <id>', 'Risk profile ID')
    .action(function (
      this: Command,
      options: {
        name: string;
        ruleset: string;
        description?: string;
        id?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');

        const details: RiskProfileForCreate = {
          name: options.name,
          ruleset: await parseJsonOption<RiskProfileRuleset>(
            options.ruleset,
            '--ruleset',
            'object'
          ),
          ...(options.description ? { description: options.description } : {}),
          ...(options.id ? { id: options.id } : {}),
        };
        const result = await new RiskProfileClient(apiClient).create(details);
        printJson(result);
      });
    });

  riskProfiles
    .command('update <id>')
    .description('Update risk profile')
    .option('--name <name>', 'Risk profile name')
    .option('--description <description>', 'Description')
    .option('--ruleset <ruleset>', 'JSON object or @file')
    .action(function (
      this: Command,
      id: string,
      options: {
        name?: string;
        description?: string;
        ruleset?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        if (
          options.name === undefined &&
          options.description === undefined &&
          options.ruleset === undefined
        ) {
          throw new Error(
            'No fields provided to update. Specify --name, --description, or --ruleset.'
          );
        }

        const details: RiskProfileForUpdate = {
          ...(options.name !== undefined ? { name: options.name } : {}),
          ...(options.description !== undefined ? { description: options.description } : {}),
          ...(options.ruleset !== undefined
            ? {
                ruleset: await parseJsonOption<RiskProfileRuleset>(
                  options.ruleset,
                  '--ruleset',
                  'object'
                ),
              }
            : {}),
        };
        const result = await new RiskProfileClient(apiClient).update(id, details);
        printJson(result);
      });
    });

  riskProfiles
    .command('delete <id>')
    .description('Delete risk profile')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new RiskProfileClient(apiClient).delete(id);
        printJson(result);
      });
    });
}
