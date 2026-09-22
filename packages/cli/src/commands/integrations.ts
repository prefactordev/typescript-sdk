import type { Command } from 'commander';
import { IntegrationClient } from '../clients/integration.js';
import { executeAuthed, printJson } from './shared.js';

/** Register account integration commands, addressed by integration type. */
export function registerIntegrationsCommands(program: Command): void {
  const integrations = program.command('integrations').description('Manage account integrations');

  integrations
    .command('list')
    .description('List configured integrations')
    .action(function (this: Command) {
      return executeAuthed(this, async (api) => {
        printJson(await new IntegrationClient(api).list());
      });
    });

  for (const [operation, description] of [
    ['retrieve', 'Retrieve integration config with secrets redacted'],
    ['delete', 'Remove an integration'],
    ['test', 'Send a test notification'],
  ] as const) {
    integrations
      .command(`${operation} <type>`)
      .description(description)
      .action(function (this: Command, type: string) {
        return executeAuthed(this, async (api) => {
          const client = new IntegrationClient(api);
          const integration = (await client.list()).summaries.find(
            (summary) => summary.integration_type === type
          );
          if (!integration) throw new Error(`Integration '${type}' is not configured.`);
          const result = await client[operation](integration.id);
          if (operation === 'test' && 'delivered' in result && !result.delivered) {
            throw new Error(`Integration '${type}' test notification was not delivered.`);
          }
          printJson(result);
        });
      });
  }

  integrations
    .command('update <type>')
    .description('Create or replace Slack integration config')
    .requiredOption('--webhook_url <url>', 'Slack incoming webhook URL (replaces the saved URL)')
    .requiredOption(
      '--enabled_events <events>',
      'Comma-separated event names; use "" for no events'
    )
    .action(function (
      this: Command,
      type: string,
      options: { webhook_url: string; enabled_events: string }
    ) {
      if (type !== 'slack') throw new Error('Only Slack configuration is supported.');
      return executeAuthed(this, async (api) => {
        const client = new IntegrationClient(api);
        const integration = (await client.list()).summaries.find(
          (summary) => summary.integration_type === type
        );
        const config = {
          _version: 1,
          webhook_url: options.webhook_url,
          enabled_events:
            options.enabled_events.trim() === ''
              ? []
              : options.enabled_events.split(',').map((event) => event.trim()),
        };
        printJson(
          integration
            ? await client.update(integration.id, { config })
            : await client.create({ integration_type: type, status: 'active', config })
        );
      });
    });
}
