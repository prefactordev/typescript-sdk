import type { Command } from 'commander';
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
                  span_type_schemas: await parseJsonOption<unknown[]>(
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
        } as Parameters<AgentInstanceClient['register']>[0]);
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
    .option('--status <status>', 'Status')
    .action(function (this: Command, id: string, options: { timestamp?: string; status?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentInstanceClient(apiClient).finish(id, {
          ...(options.timestamp ? { timestamp: options.timestamp } : {}),
          ...(options.status ? { status: options.status } : {}),
        } as Parameters<AgentInstanceClient['finish']>[1]);
        printJson(result);
      });
    });
}
