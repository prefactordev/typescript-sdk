import { type Command, Option } from 'commander';
import { AgentClient } from '../clients/agent.js';
import { AgentInstanceClient } from '../clients/agent-instance.js';
import { AgentVersionClient } from '../clients/agent-version.js';
import { executeAuthed, printJson, readTextOption, validateOptionalPfid } from './shared.js';

/** Register judge commands. A judge is an agent with the judge role. */
export function registerJudgesCommands(program: Command): void {
  const judges = program.command('judges').description('Manage judge agents');

  judges
    .command('list')
    .description('List judges')
    .action(function (this: Command) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new AgentClient(apiClient).list({ role: 'judge' }));
      });
    });

  judges
    .command('retrieve <id>')
    .description('Retrieve a judge')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new AgentClient(apiClient).retrieve(id));
      });
    });

  judges
    .command('show')
    .description('Show a judge by id or external identifier')
    .option('--agent_id <agent_id>', 'Judge agent ID')
    .option('--external_identifier <external_identifier>', 'External identifier')
    .option('--environment_id <environment_id>', 'Environment ID')
    .option('--include_counts', 'Include instance counts')
    .option('--include_risk_rollup', 'Include risk rollup')
    .action(function (
      this: Command,
      options: {
        agent_id?: string;
        external_identifier?: string;
        environment_id?: string;
        include_counts?: boolean;
        include_risk_rollup?: boolean;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        if (!options.agent_id && !options.external_identifier) {
          throw new Error('Specify --agent_id or --external_identifier.');
        }

        printJson(
          await new AgentClient(apiClient).show({
            ...(options.agent_id ? { agent_id: options.agent_id } : {}),
            ...(options.external_identifier
              ? { external_identifier: options.external_identifier }
              : {}),
            ...(options.environment_id ? { environment_id: options.environment_id } : {}),
            ...(options.include_counts ? { include_counts: true } : {}),
            ...(options.include_risk_rollup ? { include_risk_rollup: true } : {}),
          })
        );
      });
    });

  judges
    .command('create')
    .description('Create a judge')
    .requiredOption('--name <name>', 'Judge name')
    .option('--description <description>', 'Judge description')
    .option('--id <id>', 'Judge agent ID')
    .addOption(
      new Option('--execution_mode <mode>', 'Expected execution')
        .choices(['hosted', 'remote'])
        .default('hosted')
    )
    .action(function (
      this: Command,
      options: {
        name: string;
        description?: string;
        id?: string;
        execution_mode: 'hosted' | 'remote';
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');
        printJson(
          await new AgentClient(apiClient).create({
            name: options.name,
            role: 'judge',
            execution_mode: options.execution_mode,
            ...(options.description ? { description: options.description } : {}),
            ...(options.id ? { id: options.id } : {}),
          })
        );
      });
    });

  judges
    .command('update <id>')
    .description('Update a judge')
    .option('--name <name>', 'Judge name')
    .option('--description <description>', 'Judge description')
    .action(function (this: Command, id: string, options: { name?: string; description?: string }) {
      return executeAuthed(this, async (apiClient) => {
        if (options.name === undefined && options.description === undefined) {
          throw new Error('No fields provided to update. Specify --name or --description.');
        }
        printJson(
          await new AgentClient(apiClient).update(id, {
            ...(options.name !== undefined ? { name: options.name } : {}),
            ...(options.description !== undefined ? { description: options.description } : {}),
          })
        );
      });
    });

  for (const [operation, description] of [
    ['delete', 'Delete a judge'],
    ['retire', 'Retire a judge'],
    ['reinstate', 'Reinstate a judge'],
  ] as const) {
    judges
      .command(`${operation} <id>`)
      .description(description)
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const client = new AgentClient(apiClient);
          if (operation === 'delete') {
            await client.delete(id);
            printJson({ ok: true });
            return;
          }
          printJson(await client[operation](id));
        });
      });
  }

  judges
    .command('create_version')
    .description('Find or create a hosted judge version')
    .requiredOption('--agent_id <agent_id>', 'Judge agent ID')
    .requiredOption('--hosted_llm_provider_model_id <id>', 'LLM provider model ID')
    .requiredOption('--criterion <criterion>', 'Judge criterion, or @path to read a text file')
    .option('--external_identifier <external_identifier>', 'External identifier')
    .option(
      '--system_prompt_template <template>',
      'Liquid system prompt template, or @path to read a text file. criterion is the only variable'
    )
    .action(function (
      this: Command,
      options: {
        agent_id: string;
        hosted_llm_provider_model_id: string;
        criterion: string;
        external_identifier?: string;
        system_prompt_template?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new AgentVersionClient(apiClient).createHostedJudge({
            agent_id: options.agent_id,
            hosted_llm_provider_model_id: options.hosted_llm_provider_model_id,
            criterion: await readTextOption(options.criterion, '--criterion'),
            ...(options.external_identifier
              ? { external_identifier: options.external_identifier }
              : {}),
            ...(options.system_prompt_template
              ? {
                  system_prompt_template: await readTextOption(
                    options.system_prompt_template,
                    '--system_prompt_template'
                  ),
                }
              : {}),
          })
        );
      });
    });

  judges
    .command('templates')
    .description('List the built-in judge templates')
    .action(function (this: Command) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new AgentVersionClient(apiClient).judgeTemplates());
      });
    });

  judges
    .command('score <agent_instance_id>')
    .description('Ask a judge to score an agent instance')
    .requiredOption('--judge_agent_id <judge_agent_id>', 'Judge that should score this instance')
    .action(function (this: Command, agentInstanceId: string, options: { judge_agent_id: string }) {
      return executeAuthed(this, async (apiClient) => {
        printJson(
          await new AgentInstanceClient(apiClient).judge(agentInstanceId, options.judge_agent_id)
        );
      });
    });
}
