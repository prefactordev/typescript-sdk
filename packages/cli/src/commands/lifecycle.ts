import { type Command, Option } from 'commander';
import {
  createDefaultLifecycleDeps,
  doctorManagedBinary,
  type InstallCommandOptions,
  installManagedBinary,
  uninstallManagedBinary,
  updateManagedBinary,
} from '../install/installer.js';

function parseWaitForPid(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('--wait-for-pid must be a positive integer.');
  }
  return parsed;
}

export function registerLifecycleCommands(
  program: Command,
  version: string,
  deps = createDefaultLifecycleDeps()
): void {
  const createChannelOption = () =>
    new Option('--channel <channel>', 'Release channel to install').choices(['stable', 'latest']);

  program
    .command('install')
    .description('Install the Prefactor CLI into the managed user-local location')
    .addOption(createChannelOption())
    .option('--version <version>', 'Pinned release version to install')
    .addOption(new Option('--source-binary <path>').hideHelp())
    .addOption(new Option('--resolved-tag <tag>').hideHelp())
    .addOption(new Option('--asset-name <asset>').hideHelp())
    .addOption(new Option('--wait-for-pid <pid>').argParser(parseWaitForPid).hideHelp())
    .action(async (options: InstallCommandOptions) => {
      await installManagedBinary(options, version, deps);
    });

  program
    .command('update')
    .description('Update the installed Prefactor CLI')
    .addOption(createChannelOption())
    .option('--version <version>', 'Pinned release version to install')
    .action((options: { channel?: 'stable' | 'latest'; version?: string }) =>
      updateManagedBinary(options, version, deps)
    );

  program
    .command('uninstall')
    .description('Remove the managed Prefactor CLI installation')
    .action(() => uninstallManagedBinary(deps));

  program
    .command('doctor')
    .description('Print diagnostic information about the managed Prefactor CLI installation')
    .action(() => doctorManagedBinary(deps));
}
