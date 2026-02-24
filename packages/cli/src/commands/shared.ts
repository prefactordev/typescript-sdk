import { readFile } from 'node:fs/promises';
import { isPfid } from '@prefactor/pfid';
import type { Command } from 'commander';
import { ApiClient } from '../api-client.js';
import type { BulkItem } from '../clients/bulk.js';
import { DEFAULT_BASE_URL, ProfileManager, resolveCurrentProfileName } from '../profile-manager.js';

const VALID_TOKEN_SCOPES = ['account', 'environment'] as const;
// When env auth is used without PREFACTOR_API_URL, fall back to the same
// production default used for profile creation to avoid divergent defaults.
const ENV_FALLBACK_BASE_URL = DEFAULT_BASE_URL;

type GlobalOptions = { profile?: string };
type ProfileSelectionSource = 'explicit' | 'environment' | 'default';

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function getApiClient(command: Command): Promise<ApiClient> {
  const manager = await ProfileManager.create();
  const options = command.optsWithGlobals() as GlobalOptions;
  const profileSelection = resolveProfileSelection(options.profile);
  const selectedProfile = manager.getProfile(profileSelection.name);

  if (selectedProfile) {
    return new ApiClient(selectedProfile.base_url, selectedProfile.api_key);
  }

  const envToken = process.env.PREFACTOR_API_TOKEN;
  if (envToken && profileSelection.source === 'default') {
    const envApiUrl = process.env.PREFACTOR_API_URL || ENV_FALLBACK_BASE_URL;
    return new ApiClient(envApiUrl, envToken);
  }

  throw new Error(
    `No profile found for '${profileSelection.name}'. Run 'prefactor profiles add <name> <apiKey> [baseUrl]' to configure one.`
  );
}

function resolveProfileSelection(explicitProfile?: string): {
  name: string;
  source: ProfileSelectionSource;
} {
  if (explicitProfile) {
    return { name: explicitProfile, source: 'explicit' };
  }

  if (process.env.PREFACTOR_PROFILE) {
    return { name: process.env.PREFACTOR_PROFILE, source: 'environment' };
  }

  return { name: resolveCurrentProfileName(undefined), source: 'default' };
}

export async function executeAuthed(
  command: Command,
  action: (apiClient: ApiClient) => Promise<void>
): Promise<void> {
  await action(await getApiClient(command));
}

export async function parseJsonOption<T>(
  value: string,
  optionName: string,
  expectedType: 'array' | 'object'
): Promise<T> {
  const contents = value.startsWith('@')
    ? await readJsonOptionFile(value.slice(1), optionName)
    : value;

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Invalid JSON for ${optionName}: ${error instanceof Error ? error.message : 'Unknown JSON parsing error'}`
    );
  }

  if (expectedType === 'array') {
    if (!Array.isArray(parsed)) {
      throw new Error(`${optionName} must be a JSON array.`);
    }

    return parsed as T;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${optionName} must be a JSON object.`);
  }

  return parsed as T;
}

async function readJsonOptionFile(filePath: string, optionName: string): Promise<string> {
  // `@file` is an explicit local CLI convenience and should only be used with
  // trusted user input in local workflows.
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read file for ${optionName}: ${error instanceof Error ? error.message : 'Unknown file read error'}`
    );
  }
}

export function validateOptionalPfid(value: string | undefined, optionName: string): void {
  if (!value) {
    return;
  }

  if (!isPfid(value)) {
    throw new Error(`${optionName} must be a valid Prefactor ID.`);
  }
}

export function validateSpanSchemaOptions(options: {
  span_schemas?: string;
  span_type_schemas?: string;
  span_result_schemas?: string;
}): void {
  if (options.span_schemas && options.span_type_schemas) {
    throw new Error('Use only one of --span_schemas or --span_type_schemas.');
  }

  if (options.span_result_schemas && !options.span_schemas) {
    throw new Error('--span_result_schemas can only be used with --span_schemas.');
  }
}

export function validateTokenScope(scope: string): void {
  if ((VALID_TOKEN_SCOPES as readonly string[]).includes(scope)) {
    return;
  }

  throw new Error(
    `Invalid --token_scope '${scope}'. Allowed values: ${VALID_TOKEN_SCOPES.join(', ')}.`
  );
}

export function validateTokenCreateOptions(tokenScope: string, environmentId?: string): void {
  if (tokenScope !== 'environment') {
    return;
  }

  if (environmentId && environmentId.trim().length > 0) {
    return;
  }

  throw new Error("--environment_id is required when --token_scope is 'environment'.");
}

export function validateBaseUrl(baseUrl: string): void {
  try {
    void new URL(baseUrl);
  } catch {
    throw new Error('--baseUrl must be a valid URL.');
  }
}

export function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Value must be a positive integer.');
  }

  return parsed;
}

export async function parseBulkItems(value: string): Promise<BulkItem[]> {
  const parsed = await parseJsonOption<unknown[]>(value, '--items', 'array');

  for (const [index, item] of parsed.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`--items[${index}] must be a JSON object.`);
    }

    const entry = item as {
      method?: unknown;
      path?: unknown;
      body?: unknown;
    };

    if (
      entry.method !== 'GET' &&
      entry.method !== 'POST' &&
      entry.method !== 'PUT' &&
      entry.method !== 'DELETE'
    ) {
      throw new Error(`--items[${index}].method must be one of GET, POST, PUT, DELETE.`);
    }

    if (typeof entry.path !== 'string') {
      throw new Error(`--items[${index}].path must be a string.`);
    }

    if (
      entry.body !== undefined &&
      (!entry.body || typeof entry.body !== 'object' || Array.isArray(entry.body))
    ) {
      throw new Error(`--items[${index}].body must be a JSON object when provided.`);
    }
  }

  return parsed as BulkItem[];
}
