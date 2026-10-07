import type { Command } from 'commander';
import { clientPlatform } from './client-info.js';
import { parseToolOptions, reportCliConnection, requireAgentName } from './connection-report.js';
import { getAuthedContext } from './shared.js';

type ConnectOptions = {
  agentName: string;
  agentId?: string;
  tool: string[];
};

function collectTool(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerConnectCommand(program: Command, version: string): void {
  program
    .command('connect')
    .description('Report the agent and tools in use. This does not create or change an agent.')
    .requiredOption('--agent-name <name>', 'Name of the agent you are connecting')
    .option('--agent-id <id>', 'ID of an existing agent, when you already know it')
    .option(
      '--tool <tool>',
      'Tool as NAME or NAME:DESCRIPTION. Repeat for each tool.',
      collectTool,
      []
    )
    .action(async function (this: Command, options: ConnectOptions) {
      const { apiClient } = await getAuthedContext(this);
      const agentName = requireAgentName(options.agentName);
      const tools = parseToolOptions(options.tool ?? []);
      const agentId = options.agentId?.trim();
      const response = await reportCliConnection(apiClient, {
        cli_version: version,
        platform: clientPlatform(),
        agent: {
          name: agentName,
          ...(agentId ? { id: agentId } : {}),
        },
        tools,
      });

      const connectionId = readConnectionId(response);
      if (connectionId) {
        console.log(`Reported a connection for ${agentName} (${connectionId}).`);
        return;
      }

      console.log(`Reported a connection for ${agentName}.`);
    });
}

function readConnectionId(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const details = (response as { details?: unknown }).details;
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const id = (details as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}
