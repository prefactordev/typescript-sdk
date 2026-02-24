import type { Command } from 'commander';
import { ProfileManager, resolveCurrentProfileName } from '../profile-manager.js';
import { validateBaseUrl } from './shared.js';

export function registerProfilesCommands(program: Command): void {
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
          "No profiles configured. Use 'prefactor profiles add <name> [baseUrl] --api-key <apiKey>'."
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
    .command('add <name> [baseUrl]')
    .description('Add or update a profile')
    .requiredOption('--api-key <apiKey>', 'API key for this profile')
    .option('--token <apiKey>', 'Deprecated alias for --api-key')
    .action(
      async (
        name: string,
        baseUrl: string | undefined,
        options: { apiKey: string; token?: string }
      ) => {
        const apiKey = options.apiKey || options.token;

        if (!apiKey || apiKey.trim().length === 0) {
          throw new Error('Missing API key. Specify --api-key <apiKey>.');
        }

        if (baseUrl) {
          validateBaseUrl(baseUrl);
        }

        const manager = await ProfileManager.create();
        await manager.addProfile(name, apiKey, baseUrl);
        console.log(`Profile '${name}' saved.`);
      }
    );

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
