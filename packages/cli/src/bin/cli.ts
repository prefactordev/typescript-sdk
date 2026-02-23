#!/usr/bin/env node

import { runCli } from '../cli.js';

async function main(): Promise<void> {
  await runCli(process.argv);
}

void main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
