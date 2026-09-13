import { type Command, Option } from 'commander';
import {
  PlaygroundClient,
  type PlaygroundInstancePurpose,
  type PlaygroundRegisterInstanceParams,
  type PlaygroundScenario,
} from '../clients/playground.js';
import { executeAuthed, printJson, validateOptionalPfid } from './shared.js';

const SCENARIO_CHOICES = ['good', 'mixed', 'bad', 'timeout', 'active'] as const;
const PURPOSE_CHOICES = ['live', 'smoke_test', 'eval'] as const;

const EMPTY_CREATE_COMMANDS: Array<{
  command: string;
  description: string;
  run: (client: PlaygroundClient) => ReturnType<PlaygroundClient['createOpenclawAgent']>;
}> = [
  {
    command: 'create_customer_support_agent',
    description: 'Create a customer support demo agent',
    run: (client) => client.createCustomerSupportAgent(),
  },
  {
    command: 'create_loan_application_review_agent',
    description: 'Create a loan application review demo agent',
    run: (client) => client.createLoanApplicationReviewAgent(),
  },
  {
    command: 'create_northstar_support_agent',
    description: 'Create a Northstar support demo agent',
    run: (client) => client.createNorthstarSupportAgent(),
  },
  {
    command: 'create_openclaw_agent',
    description: 'Create an OpenClaw demo agent',
    run: (client) => client.createOpenclawAgent(),
  },
  {
    command: 'create_quality_review_agent',
    description: 'Create a quality review demo agent',
    run: (client) => client.createQualityReviewAgent(),
  },
];

const RECORD_SPAN_COMMANDS: Array<{
  command: string;
  description: string;
  run: (
    client: PlaygroundClient,
    agentInstanceId: string
  ) => ReturnType<PlaygroundClient['recordOpenclawSpans']>;
}> = [
  {
    command: 'record_customer_support_spans',
    description: 'Record customer support demo spans',
    run: (client, agentInstanceId) =>
      client.recordCustomerSupportSpans({ agent_instance_id: agentInstanceId }),
  },
  {
    command: 'record_loan_application_review_spans',
    description: 'Record loan application review demo spans',
    run: (client, agentInstanceId) =>
      client.recordLoanApplicationReviewSpans({ agent_instance_id: agentInstanceId }),
  },
  {
    command: 'record_northstar_support_spans',
    description: 'Record Northstar support demo spans',
    run: (client, agentInstanceId) =>
      client.recordNorthstarSupportSpans({ agent_instance_id: agentInstanceId }),
  },
  {
    command: 'record_openclaw_spans',
    description: 'Record OpenClaw demo spans',
    run: (client, agentInstanceId) =>
      client.recordOpenclawSpans({ agent_instance_id: agentInstanceId }),
  },
  {
    command: 'record_quality_review_spans',
    description: 'Record quality review demo spans',
    run: (client, agentInstanceId) =>
      client.recordQualityReviewSpans({ agent_instance_id: agentInstanceId }),
  },
];

const REGISTER_INSTANCE_COMMANDS: Array<{
  command: string;
  description: string;
  run: (
    client: PlaygroundClient,
    params: PlaygroundRegisterInstanceParams
  ) => ReturnType<PlaygroundClient['registerOpenclawAgentInstance']>;
}> = [
  {
    command: 'register_customer_support_agent_instance',
    description: 'Register a customer support demo agent instance',
    run: (client, params) => client.registerCustomerSupportAgentInstance(params),
  },
  {
    command: 'register_loan_application_review_agent_instance',
    description: 'Register a loan application review demo agent instance',
    run: (client, params) => client.registerLoanApplicationReviewAgentInstance(params),
  },
  {
    command: 'register_northstar_support_agent_instance',
    description: 'Register a Northstar support demo agent instance',
    run: (client, params) => client.registerNorthstarSupportAgentInstance(params),
  },
  {
    command: 'register_openclaw_agent_instance',
    description: 'Register an OpenClaw demo agent instance',
    run: (client, params) => client.registerOpenclawAgentInstance(params),
  },
];

function registerInstanceParams(options: {
  agent_id: string;
  environment_id: string;
  id?: string;
}): PlaygroundRegisterInstanceParams {
  validateOptionalPfid(options.id, '--id');
  return {
    agent_id: options.agent_id,
    environment_id: options.environment_id,
    ...(options.id ? { id: options.id } : {}),
  };
}

export function registerPlaygroundCommands(program: Command): void {
  const playground = program.command('playground').description('Run playground demo operations');

  for (const spec of EMPTY_CREATE_COMMANDS) {
    playground
      .command(spec.command)
      .description(spec.description)
      .action(function (this: Command) {
        return executeAuthed(this, async (apiClient) => {
          printJson(await spec.run(new PlaygroundClient(apiClient)));
        });
      });
  }

  playground
    .command('create_first_account_agent')
    .description('Create the first-account sample agent')
    .option('--environment_id <environment_id>', 'Environment ID')
    .option('--seed_instances_and_spans', 'Seed sample instances and spans')
    .action(function (
      this: Command,
      options: { environment_id?: string; seed_instances_and_spans?: boolean }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new PlaygroundClient(apiClient).createFirstAccountAgent({
          ...(options.environment_id ? { environment_id: options.environment_id } : {}),
          ...(options.seed_instances_and_spans ? { seed_instances_and_spans: true } : {}),
        });
        printJson(result);
      });
    });

  for (const spec of RECORD_SPAN_COMMANDS) {
    playground
      .command(spec.command)
      .description(spec.description)
      .requiredOption('--agent_instance_id <agent_instance_id>', 'Agent instance ID')
      .action(function (this: Command, options: { agent_instance_id: string }) {
        return executeAuthed(this, async (apiClient) => {
          printJson(await spec.run(new PlaygroundClient(apiClient), options.agent_instance_id));
        });
      });
  }

  playground
    .command('record_first_account_spans')
    .description('Record first-account sample spans')
    .requiredOption('--agent_instance_id <agent_instance_id>', 'Agent instance ID')
    .addOption(
      new Option('--scenario <scenario>', 'Sample scenario')
        .choices([...SCENARIO_CHOICES])
        .makeOptionMandatory()
    )
    .action(function (
      this: Command,
      options: { agent_instance_id: string; scenario: PlaygroundScenario }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new PlaygroundClient(apiClient).recordFirstAccountSpans({
          agent_instance_id: options.agent_instance_id,
          scenario: options.scenario,
        });
        printJson(result);
      });
    });

  for (const spec of REGISTER_INSTANCE_COMMANDS) {
    playground
      .command(spec.command)
      .description(spec.description)
      .requiredOption('--agent_id <agent_id>', 'Agent ID')
      .requiredOption('--environment_id <environment_id>', 'Environment ID')
      .option('--id <id>', 'Agent instance ID')
      .action(function (
        this: Command,
        options: { agent_id: string; environment_id: string; id?: string }
      ) {
        return executeAuthed(this, async (apiClient) => {
          printJson(
            await spec.run(new PlaygroundClient(apiClient), registerInstanceParams(options))
          );
        });
      });
  }

  playground
    .command('register_first_account_agent_instance')
    .description('Register a first-account sample agent instance')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .requiredOption('--environment_id <environment_id>', 'Environment ID')
    .addOption(
      new Option('--scenario <scenario>', 'Sample scenario')
        .choices([...SCENARIO_CHOICES])
        .makeOptionMandatory()
    )
    .option('--id <id>', 'Agent instance ID')
    .action(function (
      this: Command,
      options: {
        agent_id: string;
        environment_id: string;
        scenario: PlaygroundScenario;
        id?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new PlaygroundClient(apiClient).registerFirstAccountAgentInstance({
          ...registerInstanceParams(options),
          scenario: options.scenario,
        });
        printJson(result);
      });
    });

  playground
    .command('register_quality_review_agent_instance')
    .description('Register a quality review demo agent instance')
    .requiredOption('--agent_id <agent_id>', 'Agent ID')
    .requiredOption('--environment_id <environment_id>', 'Environment ID')
    .option('--id <id>', 'Agent instance ID')
    .addOption(new Option('--purpose <purpose>', 'Instance purpose').choices([...PURPOSE_CHOICES]))
    .action(function (
      this: Command,
      options: {
        agent_id: string;
        environment_id: string;
        id?: string;
        purpose?: PlaygroundInstancePurpose;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new PlaygroundClient(apiClient).registerQualityReviewAgentInstance({
          ...registerInstanceParams(options),
          ...(options.purpose ? { purpose: options.purpose } : {}),
        });
        printJson(result);
      });
    });
}
