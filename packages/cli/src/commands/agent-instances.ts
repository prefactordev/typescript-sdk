import { writeFile } from 'node:fs/promises';
import type { SpanTypeSchema } from '@prefactor/core';
import { type Command, Option } from 'commander';
import {
  AGENT_INSTANCE_STATUSES,
  AgentInstanceClient,
  type AgentInstanceFinishWithResultOptions,
  type AgentInstancePayloadRegistration,
  type AgentInstanceStatus,
} from '../clients/agent-instance.js';
import {
  executeAuthed,
  parseIdList,
  parseJsonOption,
  payloadSchemaOptions,
  printJson,
  validateOptionalPfid,
  validateSpanSchemaOptions,
} from './shared.js';

function parseStatuses(value: string): AgentInstanceStatus[] {
  return parseIdList(value, '--statuses').map((status) => {
    if (!(AGENT_INSTANCE_STATUSES as readonly string[]).includes(status)) {
      throw new Error(
        `--statuses has an unknown status '${status}'. Allowed: ${AGENT_INSTANCE_STATUSES.join(', ')}.`
      );
    }
    return status as AgentInstanceStatus;
  });
}

export function registerAgentInstancesCommands(program: Command): void {
  const agentInstances = program.command('agent_instances').description('Manage agent instances');

  agentInstances
    .command('list')
    .description('List agent instances')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .option(
      '--statuses <statuses>',
      `Comma-separated statuses to include (${AGENT_INSTANCE_STATUSES.join(', ')})`
    )
    .action(function (this: Command, options: { agent_id: string; statuses?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const statuses =
          options.statuses === undefined ? undefined : parseStatuses(options.statuses);
        const result = await new AgentInstanceClient(apiClient).list({
          agent_id: options.agent_id,
          ...(statuses ? { statuses } : {}),
        });
        printJson(result);
      });
    });

  agentInstances
    .command('retrieve <id>')
    .description('Retrieve agent instance')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await apiClient.request(`/agent_instance/${id}`, { method: 'GET' });
        printJson(result);
      });
    });

  agentInstances
    .command('show')
    .description('Show agent instance by id or external identifier')
    .option('--agent_instance_id <agent_instance_id>', 'Agent instance ID')
    .option('--external_identifier <external_identifier>', 'External identifier')
    .option('--include_counts', 'Include span counts')
    .option('--include_costs', 'Include cost breakdown')
    .option('--include_risk_score', 'Include risk score')
    .option('--include_alert_count', 'Include raised alert count')
    .action(function (
      this: Command,
      options: {
        agent_instance_id?: string;
        external_identifier?: string;
        include_counts?: boolean;
        include_costs?: boolean;
        include_risk_score?: boolean;
        include_alert_count?: boolean;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        if (!options.agent_instance_id && !options.external_identifier) {
          throw new Error('Specify --agent_instance_id or --external_identifier.');
        }

        const result = await new AgentInstanceClient(apiClient).show({
          ...(options.agent_instance_id ? { agent_instance_id: options.agent_instance_id } : {}),
          ...(options.external_identifier
            ? { external_identifier: options.external_identifier }
            : {}),
          ...(options.include_counts ? { include_counts: true } : {}),
          ...(options.include_costs ? { include_costs: true } : {}),
          ...(options.include_risk_score ? { include_risk_score: true } : {}),
          ...(options.include_alert_count ? { include_alert_count: true } : {}),
        });
        printJson(result);
      });
    });

  agentInstances
    .command('agent_context <id>')
    .description('Export debugging context JSON for an agent instance')
    .option('--output <path>', 'Write context JSON body to this file')
    .action(function (this: Command, id: string, options: { output?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await apiClient.request<Record<string, unknown>>(
          `/agent_instance/${id}/agent_context`,
          { method: 'GET' }
        );

        if (options.output) {
          const body = extractAgentContextBody(result);
          await writeFile(options.output, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
          return;
        }

        printJson(result);
      });
    });

  agentInstances
    .command('register')
    .description('Register agent instance')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .requiredOption(
      '--agent_version_external_identifier <agent_version_external_identifier>',
      'Agent version external identifier'
    )
    .requiredOption('--agent_version_name <agent_version_name>', 'Agent version name')
    .option('--agent_version_description <agent_version_description>', 'Agent version description')
    .requiredOption(
      '--agent_schema_version_external_identifier <agent_schema_version_external_identifier>',
      'Agent schema version external identifier'
    )
    .option('--span_schemas <span_schemas>', 'JSON object or @file')
    .option('--span_type_schemas <span_type_schemas>', 'JSON array or @file')
    .option('--span_result_schemas <span_result_schemas>', 'JSON object or @file')
    .option('--environment_id <environment_id>', 'Environment ID')
    .addOption(
      new Option('--purpose <purpose>', 'Why the run happened').choices([
        'live',
        'smoke_test',
        'eval',
      ])
    )
    .option(
      '--instance_params_payload_schema <schema>',
      'Schema for the run input: {"schema":{...},"title"?,"description"?,"template"?} or @file'
    )
    .option(
      '--instance_result_payload_schema <schema>',
      'Schema for the run result, same shape, or @file'
    )
    .option(
      '--instance_metadata_schema <schema>',
      'Schema for the run metadata, same shape, or @file'
    )
    .option('--params_payload <params_payload>', 'Run input: JSON object or @file')
    .option('--metadata <metadata>', 'Run metadata: JSON object or @file')
    .option('--id <id>', 'Agent instance ID')
    .option('--update_current_version', 'Update current version')
    .action(function (
      this: Command,
      options: {
        agent_id: string;
        agent_version_external_identifier: string;
        agent_version_name: string;
        agent_version_description?: string;
        agent_schema_version_external_identifier: string;
        span_schemas?: string;
        span_type_schemas?: string;
        span_result_schemas?: string;
        environment_id?: string;
        purpose?: 'live' | 'smoke_test' | 'eval';
        instance_params_payload_schema?: string;
        instance_result_payload_schema?: string;
        instance_metadata_schema?: string;
        params_payload?: string;
        metadata?: string;
        id?: string;
        update_current_version?: boolean;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateSpanSchemaOptions(options);
        validateOptionalPfid(options.id, '--id');

        const registration: AgentInstancePayloadRegistration = {
          agent_id: options.agent_id,
          ...(options.environment_id ? { environment_id: options.environment_id } : {}),
          ...(options.purpose ? { purpose: options.purpose } : {}),
          agent_version: {
            external_identifier: options.agent_version_external_identifier,
            name: options.agent_version_name,
            ...(options.agent_version_description
              ? { description: options.agent_version_description }
              : {}),
          },
          agent_schema_version: {
            external_identifier: options.agent_schema_version_external_identifier,
            ...(options.span_schemas
              ? {
                  span_schemas: await parseJsonOption<Record<string, unknown>>(
                    options.span_schemas,
                    '--span_schemas',
                    'object'
                  ),
                }
              : {}),
            ...(options.span_type_schemas
              ? {
                  span_type_schemas: await parseJsonOption<SpanTypeSchema[]>(
                    options.span_type_schemas,
                    '--span_type_schemas',
                    'array'
                  ),
                }
              : {}),
            ...(options.span_result_schemas
              ? {
                  span_result_schemas: await parseJsonOption<Record<string, unknown>>(
                    options.span_result_schemas,
                    '--span_result_schemas',
                    'object'
                  ),
                }
              : {}),
            ...(await payloadSchemaOptions(options)),
          },
          ...(options.params_payload
            ? {
                params_payload: await parseJsonOption<Record<string, unknown>>(
                  options.params_payload,
                  '--params_payload',
                  'object'
                ),
              }
            : {}),
          ...(options.metadata
            ? {
                metadata: await parseJsonOption<Record<string, unknown>>(
                  options.metadata,
                  '--metadata',
                  'object'
                ),
              }
            : {}),
          ...(options.id ? { id: options.id } : {}),
          ...(options.update_current_version ? { update_current_version: true } : {}),
        };
        const result = await new AgentInstanceClient(apiClient).register(registration);
        printJson(result);
      });
    });

  agentInstances
    .command('start <id>')
    .description('Start agent instance')
    .option('--timestamp <timestamp>', 'Timestamp')
    .action(function (this: Command, id: string, options: { timestamp?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentInstanceClient(apiClient).start(id, {
          ...(options.timestamp ? { timestamp: options.timestamp } : {}),
        });
        printJson(result);
      });
    });

  agentInstances
    .command('finish <id>')
    .description('Finish agent instance')
    .option('--timestamp <timestamp>', 'Timestamp')
    .addOption(
      new Option('--status <status>', 'Status').choices(['complete', 'failed', 'cancelled'])
    )
    .option(
      '--result_payload <result_payload>',
      'Run result: JSON object or @file. Recorded on complete or failed; ignored on cancelled'
    )
    .action(function (
      this: Command,
      id: string,
      options: {
        timestamp?: string;
        status?: 'complete' | 'failed' | 'cancelled';
        result_payload?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const finishOptions: AgentInstanceFinishWithResultOptions = {
          ...(options.timestamp ? { timestamp: options.timestamp } : {}),
          ...(options.status ? { status: options.status } : {}),
          ...(options.result_payload
            ? {
                result_payload: await parseJsonOption<Record<string, unknown>>(
                  options.result_payload,
                  '--result_payload',
                  'object'
                ),
              }
            : {}),
        };
        const result = await new AgentInstanceClient(apiClient).finish(id, finishOptions);
        printJson(result);
      });
    });

  agentInstances
    .command('prepare <id>')
    .description('Set the input of a preparing instance and move it to pending')
    .requiredOption('--params_payload <params_payload>', 'Run input: JSON object or @file')
    .action(function (this: Command, id: string, options: { params_payload: string }) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new AgentInstanceClient(apiClient).prepare(
            id,
            await parseJsonOption<Record<string, unknown>>(
              options.params_payload,
              '--params_payload',
              'object'
            )
          )
        );
      });
    });

  agentInstances
    .command('record_quality <id>')
    .description('Record a named quality payload on an instance')
    .requiredOption('--name <name>', 'Quality schema name')
    .requiredOption(
      '--payload <payload>',
      'Quality payload: JSON object or @file, or null to clear'
    )
    .action(function (this: Command, id: string, options: { name: string; payload: string }) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new AgentInstanceClient(apiClient).recordQuality(id, {
            name: options.name,
            payload:
              options.payload === 'null'
                ? null
                : await parseJsonOption<Record<string, unknown>>(
                    options.payload,
                    '--payload',
                    'object'
                  ),
          })
        );
      });
    });

  agentInstances
    .command('discard_sensitive <id>')
    .description(
      "Permanently delete the stored sensitive values in an instance's input, result, and metadata"
    )
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new AgentInstanceClient(apiClient).discardSensitive(id));
      });
    });

  agentInstances
    .command('terminate <id>')
    .description('Terminate agent instance')
    .requiredOption('--reason <reason>', 'Termination reason')
    .option('--timestamp <timestamp>', 'Timestamp')
    .action(function (this: Command, id: string, options: { reason: string; timestamp?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentInstanceClient(apiClient).terminate(id, {
          reason: options.reason,
          ...(options.timestamp ? { timestamp: options.timestamp } : {}),
        });
        printJson(result);
      });
    });
}

function extractAgentContextBody(result: Record<string, unknown>): unknown {
  const agentContext = result.agent_context;

  if (!agentContext || typeof agentContext !== 'object' || Array.isArray(agentContext)) {
    throw new Error('Response missing agent_context.');
  }

  if (!('body' in agentContext)) {
    throw new Error('Response missing agent_context.body.');
  }

  return agentContext.body;
}
