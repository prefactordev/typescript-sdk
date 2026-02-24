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
