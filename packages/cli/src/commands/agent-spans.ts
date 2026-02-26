import type { Command } from 'commander';
import { AgentSpanClient } from '../clients/agent-span.js';
import {
  executeAuthed,
  parseJsonOption,
  parsePositiveInt,
  printJson,
  validateOptionalPfid,
} from './shared.js';

export function registerAgentSpansCommands(program: Command): void {
  const agentSpans = program.command('agent_spans').description('Manage agent spans');

  agentSpans
    .command('list')
    .description('List agent spans')
    .requiredOption('--agent_instance_id <agent_instance_id>', 'Agent instance ID')
    .requiredOption('--start_time <start_time>', 'Start time')
    .requiredOption('--end_time <end_time>', 'End time')
    .option('--include_summaries', 'Include summaries')
    .action(function (
      this: Command,
      options: {
        agent_instance_id: string;
        start_time: string;
        end_time: string;
        include_summaries?: boolean;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentSpanClient(apiClient).list({
          agent_instance_id: options.agent_instance_id,
          start_time: options.start_time,
          end_time: options.end_time,
          ...(options.include_summaries ? { include_summaries: true } : {}),
        });
        printJson(result);
      });
    });

  agentSpans
    .command('create')
    .description('Create agent span')
    .requiredOption('--agent_instance_id <agent_instance_id>', 'Agent instance ID')
    .requiredOption('--payload <payload>', 'JSON object or @file')
    .option('--schema_name <schema_name>', 'Schema name')
    .option('--status <status>', 'Status')
    .option('--id <id>', 'Span ID')
    .option('--parent_span_id <parent_span_id>', 'Parent span ID')
    .option('--started_at <started_at>', 'Started at')
    .option('--finished_at <finished_at>', 'Finished at')
    .option('--result_payload <result_payload>', 'JSON object or @file')
    .action(function (
      this: Command,
      options: {
        agent_instance_id: string;
        payload: string;
        schema_name?: string;
        status?: string;
        id?: string;
        parent_span_id?: string;
        started_at?: string;
        finished_at?: string;
        result_payload?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');
        validateOptionalPfid(options.parent_span_id, '--parent_span_id');

        const result = await new AgentSpanClient(apiClient).create({
          agent_instance_id: options.agent_instance_id,
          payload: await parseJsonOption<Record<string, unknown>>(
            options.payload,
            '--payload',
            'object'
          ),
          ...(options.schema_name ? { schema_name: options.schema_name } : {}),
          ...(options.status ? { status: options.status } : {}),
          ...(options.id ? { id: options.id } : {}),
          ...(options.parent_span_id ? { parent_span_id: options.parent_span_id } : {}),
          ...(options.started_at ? { started_at: options.started_at } : {}),
          ...(options.finished_at ? { finished_at: options.finished_at } : {}),
          ...(options.result_payload
            ? {
                result_payload: await parseJsonOption<Record<string, unknown>>(
                  options.result_payload,
                  '--result_payload',
                  'object'
                ),
              }
            : {}),
        });
        printJson(result);
      });
    });

  agentSpans
    .command('finish <id>')
    .description('Finish agent span')
    .option('--timestamp <timestamp>', 'Timestamp')
    .option('--status <status>', 'Status')
    .option('--result_payload <result_payload>', 'JSON object or @file')
    .action(function (
      this: Command,
      id: string,
      options: { timestamp?: string; status?: string; result_payload?: string }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new AgentSpanClient(apiClient).finish(id, {
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
        });
        printJson(result);
      });
    });

  agentSpans
    .command('create_test_spans')
    .description('Create test spans')
    .requiredOption('--agent_instance_id <agent_instance_id>', 'Agent instance ID')
    .option('--count <count>', 'Count', parsePositiveInt)
    .option('--parent_span_id <parent_span_id>', 'Parent span ID')
    .action(function (
      this: Command,
      options: { agent_instance_id: string; count?: number; parent_span_id?: string }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.parent_span_id, '--parent_span_id');

        const result = await apiClient.request('/agent_spans/create_test_spans', {
          method: 'POST',
          body: {
            agent_instance_id: options.agent_instance_id,
            ...(options.count ? { count: options.count } : {}),
            ...(options.parent_span_id ? { parent_span_id: options.parent_span_id } : {}),
          },
        });
        printJson(result);
      });
    });
}
