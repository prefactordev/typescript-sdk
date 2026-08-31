import type { Command } from 'commander';
import { AdminUserClient } from '../clients/admin-user.js';
import { AdminUserInviteClient } from '../clients/admin-user-invite.js';
import { executeAuthed, printJson } from './shared.js';

const CLEAR_NULLABLE_SENTINEL = 'null';

function nullableAdminField(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === CLEAR_NULLABLE_SENTINEL ? null : value;
}

export function registerAdminCommands(program: Command): void {
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

  adminUsers
    .command('update <id>')
    .description('Update admin user')
    .option('--name <name>', 'Name')
    .option('--job_title <job_title>', `Job title (${CLEAR_NULLABLE_SENTINEL} clears the field)`)
    .option(
      '--profile_completed_at <profile_completed_at>',
      `Profile completed at (${CLEAR_NULLABLE_SENTINEL} clears the field)`
    )
    .action(function (
      this: Command,
      id: string,
      options: { name?: string; job_title?: string; profile_completed_at?: string }
    ) {
      return executeAuthed(this, async (apiClient) => {
        if (
          options.name === undefined &&
          options.job_title === undefined &&
          options.profile_completed_at === undefined
        ) {
          throw new Error(
            'No fields provided to update. Specify --name, --job_title, or --profile_completed_at.'
          );
        }

        const jobTitle = nullableAdminField(options.job_title);
        const profileCompletedAt = nullableAdminField(options.profile_completed_at);

        const result = await new AdminUserClient(apiClient).update(id, {
          ...(options.name !== undefined ? { name: options.name } : {}),
          ...(jobTitle !== undefined ? { job_title: jobTitle } : {}),
          ...(profileCompletedAt !== undefined ? { profile_completed_at: profileCompletedAt } : {}),
        });
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
