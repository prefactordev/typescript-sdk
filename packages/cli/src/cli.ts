import { Command } from 'commander';
import packageJson from '../package.json';
import { registerAccountsCommands } from './commands/accounts.js';
import { registerAdminCommands } from './commands/admin.js';
import { registerAgentInstancesCommands } from './commands/agent-instances.js';
import { registerAgentSchemaVersionsCommands } from './commands/agent-schema-versions.js';
import { registerAgentSpansCommands } from './commands/agent-spans.js';
import { registerAgentVersionsCommands } from './commands/agent-versions.js';
import { registerAgentsCommands } from './commands/agents.js';
import { registerApiTokensCommands } from './commands/api-tokens.js';
import { registerEnvironmentsCommands } from './commands/environments.js';
import { registerProfilesCommands } from './commands/profiles.js';
import { registerUtilitiesCommands } from './commands/utilities.js';

const CLI_VERSION = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';

export function createCli(version: string): Command {
  const program = new Command()
    .name('prefactor')
    .description('Prefactor CLI for managing Prefactor resources')
    .version(version)
    .showHelpAfterError('(run with --help for usage)')
    .showSuggestionAfterError(true);

  program.option('--profile <name>', 'Profile name to use for commands');

  program.addHelpText(
    'after',
    [
      '',
      'Examples:',
      '  prefactor profiles add default <api-key>',
      '  prefactor accounts list',
      '  prefactor agents list --environment_id <environment_id>',
      '  prefactor agent_spans create --agent_instance_id <id> --payload \'{"step":"tool"}\'',
    ].join('\n')
  );

  registerProfilesCommands(program);
  registerAccountsCommands(program);
  registerAgentsCommands(program);
  registerEnvironmentsCommands(program);
  registerAgentVersionsCommands(program);
  registerAgentSchemaVersionsCommands(program);
  registerAgentInstancesCommands(program);
  registerAgentSpansCommands(program);
  registerAdminCommands(program);
  registerApiTokensCommands(program);
  registerUtilitiesCommands(program, version);

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = createCli(CLI_VERSION);
  await program.parseAsync(argv);
}
