import { type Command, Option } from 'commander';
import {
  type AlertClearParams,
  AlertClient,
  type AlertListParams,
  type AlertRaiseParams,
  type AlertSeverity,
  type AlertStatus,
} from '../clients/alert.js';
import { executeAuthed, parseJsonOption, parsePositiveInt, printJson } from './shared.js';

const SEVERITY_CHOICES = ['critical', 'error', 'warning', 'info'] as const;
const STATUS_CHOICES = ['raised', 'cleared'] as const;

function parsePaginationOffset(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('--pagination_offset must be a non-negative integer.');
  }
  return parsed;
}

export function registerAlertsCommands(program: Command): void {
  const alerts = program.command('alerts').description('Manage alerts');

  alerts
    .command('list')
    .description('List alerts')
    .option('--agent_instance_id <agent_instance_id>', 'Agent instance ID')
    .option('--agent_id <agent_id>', 'Agent ID')
    .option('--environment_id <environment_id>', 'Environment ID')
    .addOption(new Option('--status <status>', 'Alert status').choices([...STATUS_CHOICES]))
    .addOption(new Option('--severity <severity>', 'Alert severity').choices([...SEVERITY_CHOICES]))
    .option('--name <name>', 'Alert name')
    .option('--active_during_start_at <active_during_start_at>', 'Active during start time')
    .option('--active_during_finish_at <active_during_finish_at>', 'Active during finish time')
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
        agent_instance_id?: string;
        agent_id?: string;
        environment_id?: string;
        status?: AlertStatus;
        severity?: AlertSeverity;
        name?: string;
        active_during_start_at?: string;
        active_during_finish_at?: string;
        sorting?: string;
        pagination_offset?: number;
        pagination_page_size?: number;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const params: AlertListParams = {
          ...(options.agent_instance_id ? { agent_instance_id: options.agent_instance_id } : {}),
          ...(options.agent_id ? { agent_id: options.agent_id } : {}),
          ...(options.environment_id ? { environment_id: options.environment_id } : {}),
          ...(options.status ? { status: options.status } : {}),
          ...(options.severity ? { severity: options.severity } : {}),
          ...(options.name ? { name: options.name } : {}),
          ...(options.active_during_start_at || options.active_during_finish_at
            ? {
                active_during: {
                  ...(options.active_during_start_at
                    ? { start_at: options.active_during_start_at }
                    : {}),
                  ...(options.active_during_finish_at
                    ? { finish_at: options.active_during_finish_at }
                    : {}),
                },
              }
            : {}),
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
        const result = await new AlertClient(apiClient).list(params);
        printJson(result);
      });
    });

  alerts
    .command('retrieve <id>')
    .description('Retrieve alert')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AlertClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  alerts
    .command('count')
    .description('Count alerts')
    .addOption(new Option('--status <status>', 'Alert status').choices([...STATUS_CHOICES]))
    .addOption(new Option('--severity <severity>', 'Alert severity').choices([...SEVERITY_CHOICES]))
    .action(function (this: Command, options: { status?: AlertStatus; severity?: AlertSeverity }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AlertClient(apiClient).count({
          ...(options.status ? { status: options.status } : {}),
          ...(options.severity ? { severity: options.severity } : {}),
        });
        printJson(result);
      });
    });

  alerts
    .command('raise')
    .description('Raise an alert')
    .requiredOption('--agent_instance_id <agent_instance_id>', 'Agent instance ID')
    .requiredOption('--name <name>', 'Alert name')
    .addOption(
      new Option('--severity <severity>', 'Alert severity')
        .choices([...SEVERITY_CHOICES])
        .makeOptionMandatory()
    )
    .requiredOption('--payload <payload>', 'JSON object or @file')
    .option('--raised_at <raised_at>', 'Raised at')
    .option('--payload_sensitive_encoding', 'Payload uses sensitive encoding')
    .action(function (
      this: Command,
      options: {
        agent_instance_id: string;
        name: string;
        severity: AlertSeverity;
        payload: string;
        raised_at?: string;
        payload_sensitive_encoding?: boolean;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const params: AlertRaiseParams = {
          agent_instance_id: options.agent_instance_id,
          name: options.name,
          severity: options.severity,
          payload: await parseJsonOption<Record<string, unknown>>(
            options.payload,
            '--payload',
            'object'
          ),
          ...(options.raised_at ? { raised_at: options.raised_at } : {}),
          ...(options.payload_sensitive_encoding ? { payload_sensitive_encoding: true } : {}),
        };
        const result = await new AlertClient(apiClient).raise(params);
        printJson(result);
      });
    });

  alerts
    .command('clear')
    .description('Clear an alert')
    .requiredOption('--agent_instance_id <agent_instance_id>', 'Agent instance ID')
    .requiredOption('--name <name>', 'Alert name')
    .option('--payload <payload>', 'JSON object or @file')
    .addOption(new Option('--severity <severity>', 'Alert severity').choices([...SEVERITY_CHOICES]))
    .option('--cleared_at <cleared_at>', 'Cleared at')
    .option('--payload_sensitive_encoding', 'Payload uses sensitive encoding')
    .action(function (
      this: Command,
      options: {
        agent_instance_id: string;
        name: string;
        payload?: string;
        severity?: AlertSeverity;
        cleared_at?: string;
        payload_sensitive_encoding?: boolean;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const params: AlertClearParams = {
          agent_instance_id: options.agent_instance_id,
          name: options.name,
          ...(options.payload
            ? {
                payload: await parseJsonOption<Record<string, unknown>>(
                  options.payload,
                  '--payload',
                  'object'
                ),
              }
            : {}),
          ...(options.severity ? { severity: options.severity } : {}),
          ...(options.cleared_at ? { cleared_at: options.cleared_at } : {}),
          ...(options.payload_sensitive_encoding ? { payload_sensitive_encoding: true } : {}),
        };
        const result = await new AlertClient(apiClient).clear(params);
        printJson(result);
      });
    });
}
