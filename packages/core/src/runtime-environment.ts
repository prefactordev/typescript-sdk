import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

/**
 * Runtime environment metadata reported at agent registration.
 *
 * Mirrors the `runtime_environment` field of the Prefactor API's
 * `agent_version` payload.
 */
export type RuntimeEnvironment = {
  /** Upstream agent framework packages (e.g. `["@prefactor/langchain@2.0.0"]`). */
  agent_sdk: string[];
  /** Host operating system name (e.g. `"linux"`, `"darwin"`, `"windows"`). */
  os: string;
  /** Prefactor SDK packages in use (e.g. `["@prefactor/core@1.0.0"]`). */
  prefactor_sdk: string[];
  /** JavaScript runtime and version (e.g. `"node@22.12.0"`, `"bun@1.2.3"`). */
  runtime: string;
};

/**
 * Builds the `runtime_environment` object for `agent_version` registration.
 *
 * Parses `sdkHeaderEntry` (a space-separated list of `"pkg@ver"` tokens set by
 * upstream adaptors) into `agent_sdk` entries, stripping the core SDK
 * self-entry. Always includes `prefactor_sdk`, `os`, and `runtime`.
 *
 * @param sdkHeaderEntry - Space-separated SDK header string set by upstream
 *   adaptors (e.g. `"@prefactor/langchain@2.0.0"`). The core self-entry
 *   (`@prefactor/core@...`) is automatically stripped from `agent_sdk`.
 * @returns Runtime environment metadata for the `agent_version` payload.
 */
export function buildRuntimeEnvironment(sdkHeaderEntry?: string): RuntimeEnvironment {
  return {
    agent_sdk: parseAgentSdk(sdkHeaderEntry),
    os: detectOs(),
    prefactor_sdk: [`${PACKAGE_NAME}@${PACKAGE_VERSION}`],
    runtime: detectRuntime(),
  };
}

function parseAgentSdk(sdkHeaderEntry: string | undefined): string[] {
  if (!sdkHeaderEntry) {
    return [];
  }

  return sdkHeaderEntry
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !token.startsWith(`${PACKAGE_NAME}@`));
}

function detectOs(): string {
  const platform = process.platform;
  return platform === 'win32' ? 'windows' : platform;
}

function detectRuntime(): string {
  const globalObject = globalThis as {
    Bun?: { version?: string };
    Deno?: { version?: { deno?: string } };
  };

  if (typeof globalObject.Bun?.version === 'string') {
    return `bun@${globalObject.Bun.version}`;
  }

  if (typeof globalObject.Deno?.version?.deno === 'string') {
    return `deno@${globalObject.Deno.version.deno}`;
  }

  return `node@${process.versions.node}`;
}
