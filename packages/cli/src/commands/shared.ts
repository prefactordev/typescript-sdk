import { readFile, stat } from 'node:fs/promises';
import { isPfid } from '@prefactor/pfid';
import type { Command } from 'commander';
import { ApiClient } from '../api-client.js';
import type { InstancePayloadSchemaForCreate } from '../clients/agent-instance.js';
import type { BulkItem } from '../clients/bulk.js';
import type { ListQueryParams } from '../clients/list-response.js';
import { DEFAULT_BASE_URL, ProfileManager, resolveCurrentProfileName } from '../profile-manager.js';

const VALID_TOKEN_SCOPES = ['account', 'agent_deployment'] as const;
const MAX_JSON_OPTION_FILE_SIZE_BYTES = 1024 * 1024;
// When env auth is used without PREFACTOR_API_URL, fall back to the same
// production default used for profile creation to avoid divergent defaults.
const ENV_FALLBACK_BASE_URL = DEFAULT_BASE_URL;

type GlobalOptions = { profile?: string };
type ProfileSelectionSource = 'explicit' | 'environment' | 'default';

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Print document text from a retrieve response, without the JSON envelope. */
export function printDocumentContent(result: { details?: { content?: unknown } }): void {
  const content = result.details?.content;
  if (typeof content !== 'string') {
    throw new Error('Response is missing document content.');
  }

  process.stdout.write(content);
}

async function getApiClient(command: Command): Promise<ApiClient> {
  return (await getAuthedContext(command)).apiClient;
}

export async function getAuthedContext(command: Command): Promise<{
  apiClient: ApiClient;
  baseUrl: string;
}> {
  const manager = await ProfileManager.create();
  const options = command.optsWithGlobals() as GlobalOptions;
  const profileSelection = resolveProfileSelection(options.profile);
  const selectedProfile = manager.getProfile(profileSelection.name);

  if (selectedProfile) {
    return {
      apiClient: new ApiClient(selectedProfile.base_url, selectedProfile.api_key),
      baseUrl: selectedProfile.base_url,
    };
  }

  const envToken = process.env.PREFACTOR_API_TOKEN;
  if (envToken && profileSelection.source === 'default') {
    const envApiUrl = process.env.PREFACTOR_API_URL || ENV_FALLBACK_BASE_URL;
    return {
      apiClient: new ApiClient(envApiUrl, envToken),
      baseUrl: envApiUrl,
    };
  }

  throw new Error(
    `No profile found for '${profileSelection.name}'. Run 'prefactor profiles add <name> [baseUrl] --api-token <apiToken>' to configure one.`
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
  expectedType: 'array' | 'object' | 'object-or-null'
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

  if (expectedType === 'object-or-null' && parsed === null) {
    return parsed as T;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      expectedType === 'object-or-null'
        ? `${optionName} must be a JSON object or null.`
        : `${optionName} must be a JSON object.`
    );
  }

  return parsed as T;
}

/** Read a text option value. `@path` reads the file as text and does not parse JSON. */
export async function readTextOption(value: string, optionName: string): Promise<string> {
  if (!value.startsWith('@')) {
    return value;
  }

  return readJsonOptionFile(value.slice(1), optionName);
}

export interface ListCommandOptions {
  sort_field?: string;
  sort_direction?: 'asc' | 'desc';
  pagination_offset?: number;
  pagination_page_size?: number;
}

/** Build list sorting and pagination params from CLI flags. */
export function listParamsFromOptions(options: ListCommandOptions): ListQueryParams {
  if (options.sort_direction !== undefined && options.sort_field === undefined) {
    throw new Error('--sort_direction requires --sort_field.');
  }

  return {
    ...(options.sort_field !== undefined
      ? {
          sorting: {
            field: options.sort_field,
            direction: options.sort_direction ?? 'asc',
          },
        }
      : {}),
    ...(options.pagination_offset !== undefined || options.pagination_page_size !== undefined
      ? {
          pagination: {
            ...(options.pagination_offset !== undefined
              ? { offset: options.pagination_offset }
              : {}),
            ...(options.pagination_page_size !== undefined
              ? { page_size: options.pagination_page_size }
              : {}),
          },
        }
      : {}),
  };
}

async function readJsonOptionFile(filePath: string, optionName: string): Promise<string> {
  // `@file` is an explicit local CLI convenience and should only be used with
  // trusted user input in local workflows.
  try {
    const fileStats = await stat(filePath);
    if (fileStats.size > MAX_JSON_OPTION_FILE_SIZE_BYTES) {
      throw new Error(
        `File for ${optionName} is too large (${fileStats.size} bytes). Maximum allowed size is ${MAX_JSON_OPTION_FILE_SIZE_BYTES} bytes.`
      );
    }

    return await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read file for ${optionName}: ${error instanceof Error ? error.message : 'Unknown file read error'}`
    );
  }
}

/** Parse the three instance payload schema options (JSON or @file) into register/create fields. */
export async function payloadSchemaOptions(options: {
  instance_params_payload_schema?: string;
  instance_result_payload_schema?: string;
  instance_metadata_schema?: string;
}): Promise<Record<string, InstancePayloadSchemaForCreate>> {
  const schemas: Record<string, InstancePayloadSchemaForCreate> = {};
  for (const key of [
    'instance_params_payload_schema',
    'instance_result_payload_schema',
    'instance_metadata_schema',
  ] as const) {
    const value = options[key];
    if (value) {
      schemas[key] = await parseJsonOption<InstancePayloadSchemaForCreate>(
        value,
        `--${key}`,
        'object'
      );
    }
  }
  return schemas;
}

/** Split a comma-separated list of IDs, dropping blanks. Throws when none remain. */
export function parseIdList(value: string, optionName: string): string[] {
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    throw new Error(`${optionName} requires at least one ID.`);
  }
  return ids;
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

export function validateTokenCreateOptions(
  tokenScope: string,
  agentId?: string,
  environmentId?: string
): void {
  const hasAgentId = Boolean(agentId && agentId.trim().length > 0);
  const hasEnvironmentId = Boolean(environmentId && environmentId.trim().length > 0);

  if (tokenScope === 'account') {
    if (!hasAgentId && !hasEnvironmentId) {
      return;
    }

    throw new Error(
      "--agent_id and --environment_id must be omitted when --token_scope is 'account'."
    );
  }

  if (tokenScope !== 'agent_deployment') {
    return;
  }

  if (hasAgentId && hasEnvironmentId) {
    return;
  }

  throw new Error(
    "--agent_id and --environment_id are required when --token_scope is 'agent_deployment'."
  );
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

export function parsePaginationOffset(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error('--pagination_offset must be a non-negative integer.');
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('--pagination_offset must be a non-negative integer.');
  }

  return parsed;
}

export async function parseBulkItems(value: string): Promise<BulkItem[]> {
  const parsed = await parseJsonOption<unknown[]>(value, '--items', 'array');

  if (parsed.length === 0) {
    throw new Error('--items must contain at least one item.');
  }

  const seenKeys = new Set<string>();
  const items: BulkItem[] = [];

  for (const [index, item] of parsed.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`--items[${index}] must be a JSON object.`);
    }

    const entry = item as Record<string, unknown>;

    if (typeof entry._type !== 'string') {
      throw new Error(`--items[${index}]._type must be a string.`);
    }

    if (typeof entry.idempotency_key !== 'string') {
      throw new Error(`--items[${index}].idempotency_key must be a string.`);
    }

    if (entry.idempotency_key.length < 8 || entry.idempotency_key.length > 128) {
      throw new Error(`--items[${index}].idempotency_key must be 8–128 characters.`);
    }

    if (seenKeys.has(entry.idempotency_key)) {
      throw new Error(`--items[${index}].idempotency_key must be unique within the request.`);
    }

    seenKeys.add(entry.idempotency_key);
    items.push({
      ...entry,
      _type: entry._type,
      idempotency_key: entry.idempotency_key,
    });
  }

  return items;
}
