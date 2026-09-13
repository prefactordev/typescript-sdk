import { writeFile } from 'node:fs/promises';
import type { SpanTypeSchema } from '@prefactor/core';
import { type Command, Option } from 'commander';
import { AgentInstanceClient } from '../clients/agent-instance.js';
import {
  executeAuthed,
  parseJsonOption,
  printJson,
  validateOptionalPfid,
  validateSpanSchemaOptions,
} from './shared.js';

export function registerAgentInstancesCommands(program: Command): void {
  const agentInstances = program.command('agent_instances').description('Manage agent instances');

  agentInstances
    .command('list')
    .description('List agent instances')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .action(function (this: Command, options: { agent_id: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await apiClient.request('/agent_instance', {
          method: 'GET',
          query: { agent_id: options.agent_id },
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
        id?: string;
        update_current_version?: boolean;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateSpanSchemaOptions(options);
        validateOptionalPfid(options.id, '--id');

        const result = await new AgentInstanceClient(apiClient).register({
          agent_id: options.agent_id,
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
          },
          ...(options.id ? { id: options.id } : {}),
          ...(options.update_current_version ? { update_current_version: true } : {}),
        });
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
    .action(function (
      this: Command,
      id: string,
      options: { timestamp?: string; status?: 'complete' | 'failed' | 'cancelled' }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentInstanceClient(apiClient).finish(id, {
          ...(options.timestamp ? { timestamp: options.timestamp } : {}),
          ...(options.status ? { status: options.status } : {}),
        });
        printJson(result);
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
