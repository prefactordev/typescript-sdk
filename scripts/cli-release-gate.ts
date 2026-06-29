import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { ROOT } from './package-config.ts';

const CLI_CHANGELOG_PATH = join(ROOT, 'packages/cli/CHANGELOG.md');
const CLI_PACKAGE_JSON_PATH = join(ROOT, 'packages/cli/package.json');

const DEPENDENCY_LINE_PATTERN = /^-\s+Updated dependencies\b/;
const DEPENDENCY_PACKAGE_LINE_PATTERN = /^-\s+@\S+\/\S+@\d+\.\d+\.\d+\s*$/;
const INDENTED_DEPENDENCY_PACKAGE_LINE_PATTERN = /^\s+-\s+@\S+\/\S+@\d+\.\d+\.\d+\s*$/;

export async function readCliVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(CLI_PACKAGE_JSON_PATH, 'utf8')) as {
    version: string;
  };
  return packageJson.version;
}

export async function npmHasVersion(packageName: string, version: string): Promise<boolean> {
  const result = await $`npm view ${packageName}@${version} version`.nothrow().quiet();
  return result.exitCode === 0;
}

export function readChangelogEntry(changelog: string, version: string): string | null {
  const header = `## ${version}`;
  const start = changelog.indexOf(header);
  if (start === -1) {
    return null;
  }

  const afterHeader = changelog.slice(start + header.length);
  const nextHeaderMatch = /\n## \d/.exec(afterHeader);
  return (
    nextHeaderMatch === null ? afterHeader : afterHeader.slice(0, nextHeaderMatch.index)
  ).trim();
}

export function hasNonDependencyReleaseLines(entry: string): boolean {
  const patchSectionMatch = /### Patch Changes\n([\s\S]*?)(?=\n### |\n## |$)/.exec(entry);
  if (patchSectionMatch === null) {
    return false;
  }

  const lines = patchSectionMatch[1]?.split('\n') ?? [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      continue;
    }

    if (DEPENDENCY_LINE_PATTERN.test(trimmed)) {
      continue;
    }
    if (DEPENDENCY_PACKAGE_LINE_PATTERN.test(trimmed)) {
      continue;
    }
    if (INDENTED_DEPENDENCY_PACKAGE_LINE_PATTERN.test(line)) {
      continue;
    }
    if (trimmed.startsWith('- ')) {
      return true;
    }
  }

  return false;
}

export async function cliHadOwnChangeset(
  version: string,
  changelogPath: string = CLI_CHANGELOG_PATH
): Promise<boolean> {
  const changelog = await readFile(changelogPath, 'utf8').catch(() => null);
  if (changelog === null) {
    return false;
  }

  const entry = readChangelogEntry(changelog, version);
  if (entry === null) {
    return false;
  }

  return hasNonDependencyReleaseLines(entry);
}

export async function shouldDispatchCliBinaryRelease(
  version: string,
  options: {
    alreadyOnNpm?: boolean;
    hadOwnChangeset?: boolean;
  } = {}
): Promise<boolean> {
  const alreadyOnNpm = options.alreadyOnNpm ?? (await npmHasVersion('@prefactor/cli', version));
  const hadOwnChangeset = options.hadOwnChangeset ?? (await cliHadOwnChangeset(version));
  const cliWillPublish = !alreadyOnNpm;

  return cliWillPublish && hadOwnChangeset;
}
