#!/usr/bin/env bun

import { $ } from 'bun';

await $`bun run build`;
await $`changeset publish`;
