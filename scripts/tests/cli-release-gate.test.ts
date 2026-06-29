import { describe, expect, test } from 'bun:test';
import {
  hasNonDependencyReleaseLines,
  readChangelogEntry,
  shouldDispatchCliBinaryRelease,
} from '../cli-release-gate.ts';

describe('readChangelogEntry', () => {
  test('returns the section for the requested version', () => {
    const changelog = `# @prefactor/cli

## 0.1.2

### Patch Changes

- Add install retry

## 0.1.1

### Patch Changes

- Initial release
`;

    expect(readChangelogEntry(changelog, '0.1.2')).toBe(`### Patch Changes

- Add install retry`);
  });
});

describe('hasNonDependencyReleaseLines', () => {
  test('returns true for direct CLI changeset entries', () => {
    const entry = `### Patch Changes

- [#123](https://github.com/prefactordev/typescript-sdk/pull/123) - Improve install diagnostics`;

    expect(hasNonDependencyReleaseLines(entry)).toBe(true);
  });

  test('returns false for dependency-only cascade entries', () => {
    const entry = `### Patch Changes

- Updated dependencies [abc1234](https://github.com/prefactordev/typescript-sdk/commit/abc1234):
  - @prefactor/core@0.4.2`;

    expect(hasNonDependencyReleaseLines(entry)).toBe(false);
  });

  test('returns false for standalone dependency release lines', () => {
    const entry = `### Patch Changes

- @prefactor/core@0.4.2`;

    expect(hasNonDependencyReleaseLines(entry)).toBe(false);
  });
});

describe('shouldDispatchCliBinaryRelease', () => {
  test('requires both a new npm version and an intentional CLI changeset', async () => {
    await expect(
      shouldDispatchCliBinaryRelease('0.1.2', {
        alreadyOnNpm: false,
        hadOwnChangeset: true,
      })
    ).resolves.toBe(true);

    await expect(
      shouldDispatchCliBinaryRelease('0.1.2', {
        alreadyOnNpm: false,
        hadOwnChangeset: false,
      })
    ).resolves.toBe(false);

    await expect(
      shouldDispatchCliBinaryRelease('0.1.2', {
        alreadyOnNpm: true,
        hadOwnChangeset: true,
      })
    ).resolves.toBe(false);
  });
});
