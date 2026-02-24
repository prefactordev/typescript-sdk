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

/**
 * Creates a configured Commander CLI program.
 *
 * This factory is exported for test usage to assert command registration and
 * parse behavior without going through the bin entrypoint.
 *
 * @param version CLI version string shown in help/version output.
 * @returns Configured Commander command instance.
 * @internal
 */
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
      '  prefactor profiles add default --api-key <api-key>',
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

/**
 * Parses and executes CLI commands for the current process invocation.
 *
 * @param argv Process argument vector, typically `process.argv`.
 * @returns Promise that resolves when command execution completes.
 */
export async function runCli(argv: string[]): Promise<void> {
  const program = createCli(CLI_VERSION);
  await program.parseAsync(argv);
}
