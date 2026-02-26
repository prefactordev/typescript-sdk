#!/usr/bin/env node

import { inspect } from 'node:util';
import { HttpClientError } from '@prefactor/core';
import { runCli } from '../cli.js';

async function main(): Promise<void> {
  await runCli(process.argv);
}

void main().catch((error: unknown) => {
  if (error instanceof HttpClientError) {
    console.error(error.message);
    if (error.responseBody !== undefined && error.responseBody !== null) {
      if (typeof error.responseBody === 'string') {
        console.error(error.responseBody);
      } else {
        try {
          console.error(JSON.stringify(error.responseBody, null, 2));
        } catch (serializationError) {
          const reason =
            serializationError instanceof Error
              ? serializationError.message
              : String(serializationError);
          console.error(`[unserializable responseBody] ${reason}`);
          console.error(inspect(error.responseBody));
        }
      }
    }
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
