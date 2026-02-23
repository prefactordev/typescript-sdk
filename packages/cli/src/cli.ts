import { readFile } from 'node:fs/promises';
import { isPfid } from '@prefactor/pfid';
import { Command } from 'commander';
import { ApiClient } from './api-client.js';
import { AccountClient } from './clients/account.js';
import { AdminUserClient } from './clients/admin-user.js';
import { AdminUserInviteClient } from './clients/admin-user-invite.js';
import { AgentClient } from './clients/agent.js';
import { AgentInstanceClient } from './clients/agent-instance.js';
import { AgentSchemaVersionClient } from './clients/agent-schema-version.js';
import { AgentSpanClient } from './clients/agent-span.js';
import { AgentVersionClient } from './clients/agent-version.js';
import { ApiTokenClient } from './clients/api-token.js';
import type { BulkItem } from './clients/bulk.js';
import { BulkClient } from './clients/bulk.js';
import { EnvironmentClient } from './clients/environment.js';
import { PfidClient } from './clients/pfid.js';
import { DEFAULT_BASE_URL, ProfileManager, resolveCurrentProfileName } from './profile-manager.js';

const VALID_TOKEN_SCOPES = ['account', 'environment'] as const;
// When env auth is used without PREFACTOR_API_URL, fall back to the same
// production default used for profile creation to avoid divergent defaults.
const ENV_FALLBACK_BASE_URL = DEFAULT_BASE_URL;

type GlobalOptions = { profile?: string };
type ProfileSelectionSource = 'explicit' | 'environment' | 'default';

async function loadVersion(): Promise<string> {
  try {
    const packageJsonPath = new URL('../package.json', import.meta.url);
    const packageJsonContents = await readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContents) as { version?: unknown };

    if (typeof packageJson.version === 'string') {
      return packageJson.version;
    }
  } catch {}

  return '0.0.0';
}

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

  function registerProfilesCommands(): void {
    const profiles = program.command('profiles').description('Manage CLI profiles');

    profiles
      .command('list')
      .description('List configured profiles')
      .action(async function (this: Command) {
        const manager = await ProfileManager.create();
        const options = this.optsWithGlobals() as { profile?: string };
        const currentProfileName = resolveCurrentProfileName(options.profile);
        const profiles = manager.getProfileEntries();

        if (profiles.length === 0) {
          console.log(
            "No profiles configured. Use 'prefactor profiles add <name> <apiKey> [baseUrl]'."
          );
          return;
        }

        for (const [name, profile] of profiles) {
          if (name === currentProfileName) {
            console.log(`${name} (current) - ${profile.base_url}`);
          } else {
            console.log(`${name} - ${profile.base_url}`);
          }
        }
      });

    profiles
      .command('add <name> <apiKey> [baseUrl]')
      .description('Add or update a profile')
      .action(async (name: string, apiKey: string, baseUrl?: string) => {
        if (baseUrl) {
          validateBaseUrl(baseUrl);
        }

        const manager = await ProfileManager.create();
        await manager.addProfile(name, apiKey, baseUrl);
        console.log(`Profile '${name}' saved.`);
      });

    profiles
      .command('remove <name>')
      .description('Remove a profile')
      .action(async (name: string) => {
        const manager = await ProfileManager.create();
        const removed = await manager.removeProfile(name);

        if (removed) {
          console.log(`Profile '${name}' removed.`);
          return;
        }

        console.log(`Profile '${name}' not found.`);
      });
  }

  registerProfilesCommands();

  function registerAccountsCommands(): void {
    const accounts = program.command('accounts').description('Manage accounts');

    accounts
      .command('list')
      .description('List accounts')
      .action(function (this: Command) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AccountClient(apiClient).list();
          printJson(result);
        });
      });

    accounts
      .command('retrieve <id>')
      .description('Retrieve account')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AccountClient(apiClient).retrieve(id);
          printJson(result);
        });
      });

    accounts
      .command('update <id>')
      .description('Update account')
      .requiredOption('--name <name>', 'Account name')
      .action(function (this: Command, id: string, options: { name: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AccountClient(apiClient).update(id, { name: options.name });
          printJson(result);
        });
      });
  }

  registerAccountsCommands();

  function registerAgentsCommands(): void {
    const agents = program.command('agents').description('Manage agents');

    agents
      .command('list')
      .description('List agents')
      .requiredOption('--environment_id <environment_id>', 'Environment ID')
      .action(function (this: Command, options: { environment_id: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentClient(apiClient).list(options.environment_id);
          printJson(result);
        });
      });

    agents
      .command('retrieve <id>')
      .description('Retrieve agent')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentClient(apiClient).retrieve(id);
          printJson(result);
        });
      });

    agents
      .command('create')
      .description('Create agent')
      .requiredOption('--name <name>', 'Agent name')
      .requiredOption('--environment_id <environment_id>', 'Environment ID')
      .option('--description <description>', 'Agent description')
      .option('--id <id>', 'Agent ID')
      .action(function (
        this: Command,
        options: {
          name: string;
          environment_id: string;
          description?: string;
          id?: string;
        }
      ) {
        return executeAuthed(this, async (apiClient) => {
          validateOptionalPfid(options.id, '--id');

          const result = await new AgentClient(apiClient).create({
            name: options.name,
            environment_id: options.environment_id,
            ...(options.description ? { description: options.description } : {}),
            ...(options.id ? { id: options.id } : {}),
          });
          printJson(result);
        });
      });

    agents
      .command('update <id>')
      .description('Update agent')
      .option('--name <name>', 'Agent name')
      .option('--description <description>', 'Agent description')
      .option('--current_version_id <current_version_id>', 'Current version ID')
      .action(function (
        this: Command,
        id: string,
        options: { name?: string; description?: string; current_version_id?: string }
      ) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentClient(apiClient).update(id, {
            ...(options.name ? { name: options.name } : {}),
            ...(options.description ? { description: options.description } : {}),
            ...(options.current_version_id
              ? { current_version_id: options.current_version_id }
              : {}),
          });
          printJson(result);
        });
      });

    agents
      .command('delete <id>')
      .description('Delete agent')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          await new AgentClient(apiClient).delete(id);
          printJson({ ok: true });
        });
      });

    agents
      .command('retire <id>')
      .description('Retire agent')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentClient(apiClient).retire(id);
          printJson(result);
        });
      });

    agents
      .command('reinstate <id>')
      .description('Reinstate agent')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentClient(apiClient).reinstate(id);
          printJson(result);
        });
      });
  }

  registerAgentsCommands();

  function registerEnvironmentsCommands(): void {
    const environments = program.command('environments').description('Manage environments');

    environments
      .command('list')
      .description('List environments')
      .requiredOption('--account_id <account_id>', 'Account ID')
      .action(function (this: Command, options: { account_id: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new EnvironmentClient(apiClient).list(options.account_id);
          printJson(result);
        });
      });

    environments
      .command('retrieve <id>')
      .description('Retrieve environment')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new EnvironmentClient(apiClient).retrieve(id);
          printJson(result);
        });
      });

    environments
      .command('create')
      .description('Create environment')
      .requiredOption('--name <name>', 'Environment name')
      .requiredOption('--account_id <account_id>', 'Account ID')
      .option('--id <id>', 'Environment ID')
      .action(function (this: Command, options: { name: string; account_id: string; id?: string }) {
        return executeAuthed(this, async (apiClient) => {
          validateOptionalPfid(options.id, '--id');

          const result = await new EnvironmentClient(apiClient).create({
            name: options.name,
            account_id: options.account_id,
            ...(options.id ? { id: options.id } : {}),
          });
          printJson(result);
        });
      });

    environments
      .command('update <id>')
      .description('Update environment')
      .option('--name <name>', 'Environment name')
      .action(function (this: Command, id: string, options: { name?: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new EnvironmentClient(apiClient).update(id, {
            ...(options.name ? { name: options.name } : {}),
          });
          printJson(result);
        });
      });

    environments
      .command('delete <id>')
      .description('Delete environment')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          await new EnvironmentClient(apiClient).delete(id);
          printJson({ ok: true });
        });
      });
  }

  registerEnvironmentsCommands();

  function registerAgentVersionAndSchemaVersionCommands(): void {
    const agentVersions = program.command('agent_versions').description('Manage agent versions');

    agentVersions
      .command('list')
      .description('List agent versions')
      .requiredOption('--agent_id <agent_id>', 'Agent ID')
      .action(function (this: Command, options: { agent_id: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentVersionClient(apiClient).list(options.agent_id);
          printJson(result);
        });
      });

    agentVersions
      .command('retrieve <id>')
      .description('Retrieve agent version')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentVersionClient(apiClient).retrieve(id);
          printJson(result);
        });
      });

    agentVersions
      .command('create')
      .description('Create agent version')
      .requiredOption('--agent_id <agent_id>', 'Agent ID')
      .requiredOption('--external_identifier <external_identifier>', 'External identifier')
      .action(function (this: Command, options: { agent_id: string; external_identifier: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentVersionClient(apiClient).create(
            options.agent_id,
            options.external_identifier
          );
          printJson(result);
        });
      });

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

  registerAgentVersionAndSchemaVersionCommands();

  function registerAgentInstanceCommands(): void {
    const agentInstances = program.command('agent_instances').description('Manage agent instances');

    agentInstances
      .command('list')
      .description('List agent instances')
      .requiredOption('--agent_id <agent_id>', 'Agent ID')
      .action(function (this: Command, options: { agent_id: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentInstanceClient(apiClient).list(options.agent_id);
          printJson(result);
        });
      });

    agentInstances
      .command('retrieve <id>')
      .description('Retrieve agent instance')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentInstanceClient(apiClient).retrieve(id);
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
      .option(
        '--agent_version_description <agent_version_description>',
        'Agent version description'
      )
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
          const result = await new AgentInstanceClient(apiClient).start(id, options.timestamp);
          printJson(result);
        });
      });

    agentInstances
      .command('finish <id>')
      .description('Finish agent instance')
      .option('--timestamp <timestamp>', 'Timestamp')
      .option('--status <status>', 'Status')
      .action(function (
        this: Command,
        id: string,
        options: { timestamp?: string; status?: string }
      ) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AgentInstanceClient(apiClient).finish(id, {
            ...(options.timestamp ? { timestamp: options.timestamp } : {}),
            ...(options.status ? { status: options.status } : {}),
          });
          printJson(result);
        });
      });
  }

  registerAgentInstanceCommands();

  function registerAgentSpanCommands(): void {
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

  registerAgentSpanCommands();

  function registerAdminCommands(): void {
    const adminUsers = program.command('admin_users').description('Manage admin users');

    adminUsers
      .command('list')
      .description('List admin users')
      .option('--account_id <account_id>', 'Account ID')
      .action(function (this: Command, options: { account_id?: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AdminUserClient(apiClient).list(options.account_id);
          printJson(result);
        });
      });

    adminUsers
      .command('retrieve <id>')
      .description('Retrieve admin user')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AdminUserClient(apiClient).retrieve(id);
          printJson(result);
        });
      });

    const adminUserInvites = program
      .command('admin_user_invites')
      .description('Manage admin user invites');

    adminUserInvites
      .command('list')
      .description('List admin user invites')
      .option('--account_id <account_id>', 'Account ID')
      .action(function (this: Command, options: { account_id?: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AdminUserInviteClient(apiClient).list(options.account_id);
          printJson(result);
        });
      });

    adminUserInvites
      .command('retrieve <id>')
      .description('Retrieve admin user invite')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AdminUserInviteClient(apiClient).retrieve(id);
          printJson(result);
        });
      });

    adminUserInvites
      .command('create')
      .description('Create admin user invite')
      .requiredOption('--email <email>', 'Email')
      .option('--account_id <account_id>', 'Account ID')
      .action(function (this: Command, options: { email: string; account_id?: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AdminUserInviteClient(apiClient).create(
            options.email,
            options.account_id
          );
          printJson(result);
        });
      });

    adminUserInvites
      .command('revoke <id>')
      .description('Revoke admin user invite')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new AdminUserInviteClient(apiClient).revoke(id);
          printJson(result);
        });
      });
  }

  registerAdminCommands();

  function registerApiTokenCommands(): void {
    const apiTokens = program.command('api_tokens').description('Manage API tokens');

    apiTokens
      .command('list')
      .description('List API tokens')
      .option('--account_id <account_id>', 'Account ID')
      .action(function (this: Command, options: { account_id?: string }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new ApiTokenClient(apiClient).list(options.account_id);
          printJson(result);
        });
      });

    apiTokens
      .command('retrieve <id>')
      .description('Retrieve API token')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new ApiTokenClient(apiClient).retrieve(id);
          printJson(result);
        });
      });

    apiTokens
      .command('create')
      .description('Create API token')
      .requiredOption('--token_scope <token_scope>', 'Token scope')
      .option('--account_id <account_id>', 'Account ID')
      .option('--environment_id <environment_id>', 'Environment ID')
      .option('--expires_at <expires_at>', 'Expiration timestamp')
      .action(function (
        this: Command,
        options: {
          token_scope: string;
          account_id?: string;
          environment_id?: string;
          expires_at?: string;
        }
      ) {
        return executeAuthed(this, async (apiClient) => {
          validateTokenScope(options.token_scope);
          validateTokenCreateOptions(options.token_scope, options.environment_id);

          const result = await new ApiTokenClient(apiClient).create({
            token_scope: options.token_scope,
            ...(options.account_id ? { account_id: options.account_id } : {}),
            ...(options.environment_id ? { environment_id: options.environment_id } : {}),
            ...(options.expires_at ? { expires_at: options.expires_at } : {}),
          });
          printJson(result);
        });
      });

    apiTokens
      .command('suspend <id>')
      .description('Suspend API token')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new ApiTokenClient(apiClient).suspend(id);
          printJson(result);
        });
      });

    apiTokens
      .command('activate <id>')
      .description('Activate API token')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new ApiTokenClient(apiClient).activate(id);
          printJson(result);
        });
      });

    apiTokens
      .command('revoke <id>')
      .description('Revoke API token')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new ApiTokenClient(apiClient).revoke(id);
          printJson(result);
        });
      });

    apiTokens
      .command('delete <id>')
      .description('Delete API token')
      .action(function (this: Command, id: string) {
        return executeAuthed(this, async (apiClient) => {
          await new ApiTokenClient(apiClient).delete(id);
          printJson({ ok: true });
        });
      });
  }

  registerApiTokenCommands();

  function registerUtilityCommands(): void {
    const pfid = program.command('pfid').description('Generate PFIDs');

    pfid
      .command('generate')
      .description('Generate PFIDs')
      .option('--account_id <account_id>', 'Account ID')
      .option('--count <count>', 'Number of IDs to generate', parsePositiveInt)
      .action(function (this: Command, options: { account_id?: string; count?: number }) {
        return executeAuthed(this, async (apiClient) => {
          const result = await new PfidClient(apiClient).generate(
            options.count ?? 1,
            options.account_id
          );
          printJson(result);
        });
      });

    const bulk = program.command('bulk').description('Execute bulk API requests');

    bulk
      .command('execute')
      .description('Execute bulk requests')
      .requiredOption('--items <items>', 'JSON array or @file')
      .action(function (this: Command, options: { items: string }) {
        return executeAuthed(this, async (apiClient) => {
          const items = await parseBulkItems(options.items);
          const result = await new BulkClient(apiClient).execute(items);
          printJson(result);
        });
      });

    program
      .command('version')
      .description('Print CLI version')
      .action(() => {
        console.log(version);
      });
  }

  registerUtilityCommands();

  return program;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function getApiClient(command: Command): Promise<ApiClient> {
  const manager = await ProfileManager.create();
  const options = command.optsWithGlobals() as GlobalOptions;
  const profileSelection = resolveProfileSelection(options.profile);
  const selectedProfile = manager.getProfile(profileSelection.name);

  if (selectedProfile) {
    return new ApiClient(selectedProfile.base_url, selectedProfile.api_key);
  }

  const envToken = process.env.PREFACTOR_API_TOKEN;
  if (envToken && profileSelection.source === 'default') {
    const envApiUrl = process.env.PREFACTOR_API_URL || ENV_FALLBACK_BASE_URL;
    return new ApiClient(envApiUrl, envToken);
  }

  throw new Error(
    `No profile found for '${profileSelection.name}'. Run 'prefactor profiles add <name> <apiKey> [baseUrl]' to configure one.`
  );
}

function resolveProfileSelection(explicitProfile?: string): {
  name: string;
  source: ProfileSelectionSource;
} {
  if (explicitProfile) {
    return { name: explicitProfile, source: 'explicit' };
  }

  if (process.env.PREFACTOR_PROFILE) {
    return { name: process.env.PREFACTOR_PROFILE, source: 'environment' };
  }

  return { name: resolveCurrentProfileName(undefined), source: 'default' };
}

async function executeAuthed(
  command: Command,
  action: (apiClient: ApiClient) => Promise<void>
): Promise<void> {
  await action(await getApiClient(command));
}

async function parseJsonOption<T>(
  value: string,
  optionName: string,
  expectedType: 'array' | 'object'
): Promise<T> {
  const contents = value.startsWith('@')
    ? await readJsonOptionFile(value.slice(1), optionName)
    : value;

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Invalid JSON for ${optionName}: ${error instanceof Error ? error.message : 'Unknown JSON parsing error'}`
    );
  }

  if (expectedType === 'array') {
    if (!Array.isArray(parsed)) {
      throw new Error(`${optionName} must be a JSON array.`);
    }

    return parsed as T;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${optionName} must be a JSON object.`);
  }

  return parsed as T;
}

async function readJsonOptionFile(filePath: string, optionName: string): Promise<string> {
  // `@file` is an explicit local CLI convenience and should only be used with
  // trusted user input in local workflows.
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read file for ${optionName}: ${error instanceof Error ? error.message : 'Unknown file read error'}`
    );
  }
}

function validateOptionalPfid(value: string | undefined, optionName: string): void {
  if (!value) {
    return;
  }

  if (!isPfid(value)) {
    throw new Error(`${optionName} must be a valid Prefactor ID.`);
  }
}

function validateSpanSchemaOptions(options: {
  span_schemas?: string;
  span_type_schemas?: string;
  span_result_schemas?: string;
}): void {
  if (options.span_schemas && options.span_type_schemas) {
    throw new Error('Use only one of --span_schemas or --span_type_schemas.');
  }

  if (options.span_result_schemas && !options.span_schemas) {
    throw new Error('--span_result_schemas can only be used with --span_schemas.');
  }
}

function validateTokenScope(scope: string): void {
  if ((VALID_TOKEN_SCOPES as readonly string[]).includes(scope)) {
    return;
  }

  throw new Error(
    `Invalid --token_scope '${scope}'. Allowed values: ${VALID_TOKEN_SCOPES.join(', ')}.`
  );
}

function validateTokenCreateOptions(tokenScope: string, environmentId?: string): void {
  if (tokenScope !== 'environment') {
    return;
  }

  if (environmentId && environmentId.trim().length > 0) {
    return;
  }

  throw new Error("--environment_id is required when --token_scope is 'environment'.");
}

function validateBaseUrl(baseUrl: string): void {
  try {
    void new URL(baseUrl);
  } catch {
    throw new Error('--baseUrl must be a valid URL.');
  }
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Value must be a positive integer.');
  }

  return parsed;
}

async function parseBulkItems(value: string): Promise<BulkItem[]> {
  const parsed = await parseJsonOption<unknown[]>(value, '--items', 'array');

  for (const [index, item] of parsed.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`--items[${index}] must be a JSON object.`);
    }

    const entry = item as {
      method?: unknown;
      path?: unknown;
      body?: unknown;
    };

    if (
      entry.method !== 'GET' &&
      entry.method !== 'POST' &&
      entry.method !== 'PUT' &&
      entry.method !== 'DELETE'
    ) {
      throw new Error(`--items[${index}].method must be one of GET, POST, PUT, DELETE.`);
    }

    if (typeof entry.path !== 'string') {
      throw new Error(`--items[${index}].path must be a string.`);
    }

    if (
      entry.body !== undefined &&
      (!entry.body || typeof entry.body !== 'object' || Array.isArray(entry.body))
    ) {
      throw new Error(`--items[${index}].body must be a JSON object when provided.`);
    }
  }

  return parsed as BulkItem[];
}

export async function runCli(argv: string[]): Promise<void> {
  const version = await loadVersion();
  const program = createCli(version);
  await program.parseAsync(argv);
}
