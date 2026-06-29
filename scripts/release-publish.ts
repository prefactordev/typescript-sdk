#!/usr/bin/env bun

import { $ } from 'bun';
import {
  cliHadOwnChangeset,
  npmHasVersion,
  readCliVersion,
  shouldDispatchCliBinaryRelease,
} from './cli-release-gate.ts';
import { dispatchCliBinaryRelease } from './dispatch-cli-binary-release.ts';

await $`bun run build`;

const cliVersion = await readCliVersion();
const alreadyOnNpm = await npmHasVersion('@prefactor/cli', cliVersion);
const hadOwnChangeset = await cliHadOwnChangeset(cliVersion);
const cliWillPublish = !alreadyOnNpm;

console.log(`@prefactor/cli@${cliVersion}`);
console.log(`- already on npm: ${alreadyOnNpm ? 'yes' : 'no'}`);
console.log(`- intentional CLI changeset: ${hadOwnChangeset ? 'yes' : 'no'}`);

const publishResult = await $`changeset publish`.nothrow();
const publishOutput = `${publishResult.stdout}${publishResult.stderr}`;

if (publishOutput.length > 0) {
  process.stdout.write(publishOutput);
}

if (publishResult.exitCode !== 0) {
  process.exit(publishResult.exitCode ?? 1);
}

if (await shouldDispatchCliBinaryRelease(cliVersion, { alreadyOnNpm, hadOwnChangeset })) {
  console.log(`Triggering GitHub CLI binary release for v${cliVersion}...`);
  dispatchCliBinaryRelease(cliVersion);
} else if (cliWillPublish && !hadOwnChangeset) {
  console.log('Published CLI npm patch from dependency alignment only; skipping binary release.');
} else {
  console.log('No CLI binary release needed.');
}
