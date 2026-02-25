import type { Command } from 'commander';
import { AgentSchemaVersionClient } from '../clients/agent-schema-version.js';
import { executeAuthed, parseJsonOption, printJson, validateSpanSchemaOptions } from './shared.js';

export function registerAgentSchemaVersionsCommands(program: Command): void {
  const agentSchemaVersions = program
    .command('agent_schema_versions')
    .description('Manage agent schema versions');

  agentSchemaVersions
    .command('list')
    .description('List agent schema versions')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .action(function (this: Command, options: { agent_id: string }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentSchemaVersionClient(apiClient).list(options.agent_id);
        printJson(result);
      });
    });

  agentSchemaVersions
    .command('retrieve <id>')
    .description('Retrieve agent schema version')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentSchemaVersionClient(apiClient).retrieve(id);
        printJson(result);
      });
    });

  agentSchemaVersions
    .command('create')
    .description('Create agent schema version')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .requiredOption('--external_identifier <external_identifier>', 'External identifier')
    .option('--span_schemas <span_schemas>', 'JSON object or @file')
    .option('--span_type_schemas <span_type_schemas>', 'JSON array or @file')
    .option('--span_result_schemas <span_result_schemas>', 'JSON object or @file')
    .action(function (
      this: Command,
      options: {
        agent_id: string;
        external_identifier: string;
        span_schemas?: string;
        span_type_schemas?: string;
        span_result_schemas?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateSpanSchemaOptions(options);

        const result = await new AgentSchemaVersionClient(apiClient).create(
          options.agent_id,
          options.external_identifier,
          {
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
          }
        );
        printJson(result);
      });
    });
}
