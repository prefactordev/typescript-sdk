import { dirname } from 'node:path';

export const ROOT = dirname(import.meta.dir);

export interface PackageConfig {
  name: string;
  path: string;
  entrypoint?: string;
  entrypoints?: string[];
  external: string[];
  generateVersionModule?: boolean;
}

export const PACKAGE_CONFIGS: PackageConfig[] = [
  {
    name: '@prefactor/core',
    path: 'packages/core',
    entrypoint: './packages/core/src/index.ts',
    external: ['@prefactor/pfid', 'zod'],
    generateVersionModule: true,
  },
  {
    name: '@prefactor/cli',
    path: 'packages/cli',
    entrypoints: ['./packages/cli/src/index.ts', './packages/cli/src/bin/cli.ts'],
    external: ['@prefactor/core', 'commander'],
  },
  {
    name: '@prefactor/ai',
    path: 'packages/ai',
    entrypoint: './packages/ai/src/index.ts',
    external: ['@prefactor/core', '@prefactor/pfid'],
    generateVersionModule: true,
  },
  {
    name: '@prefactor/claude',
    path: 'packages/claude',
    entrypoint: './packages/claude/src/index.ts',
    external: ['@prefactor/core', '@prefactor/pfid', '@anthropic-ai/claude-agent-sdk'],
    generateVersionModule: true,
  },
  {
    name: '@prefactor/langchain',
    path: 'packages/langchain',
    entrypoint: './packages/langchain/src/index.ts',
    external: ['@prefactor/core', '@prefactor/pfid', '@langchain/core', 'langchain', 'zod'],
    generateVersionModule: true,
  },
  {
    name: '@prefactor/openclaw-prefactor-plugin',
    path: 'packages/openclaw-prefactor-plugin',
    entrypoint: './packages/openclaw-prefactor-plugin/src/index.ts',
    external: ['@prefactor/core', 'zod'],
  },
];
