import type { Command } from 'commander';
import { ApiClient } from '../api-client.js';
import { BulkClient } from '../clients/bulk.js';
import { PfidClient } from '../clients/pfid.js';
import { UtilsClient, type UtilsRenderLiquidTemplateSample } from '../clients/utils.js';
import { DEFAULT_BASE_URL } from '../profile-manager.js';
import {
  executeAuthed,
  parseBulkItems,
  parseJsonOption,
  parsePositiveInt,
  printJson,
  readTextOption,
} from './shared.js';

async function parseTemplateSamples(value: string): Promise<UtilsRenderLiquidTemplateSample[]> {
  const parsed = await parseJsonOption<unknown[]>(value, '--samples', 'array');

  return parsed.map((item, index) => {
    if (!isJsonObject(item)) {
      throw new Error(`--samples[${index}] must be a JSON object.`);
    }

    if (!isJsonObject(item.payload)) {
      throw new Error(`--samples[${index}].payload must be a JSON object.`);
    }

    if (
      'result_payload' in item &&
      item.result_payload !== null &&
      !isJsonObject(item.result_payload)
    ) {
      throw new Error(`--samples[${index}].result_payload must be a JSON object or null.`);
    }

    return Object.assign({ payload: item.payload }, item);
  });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function registerUtilitiesCommands(program: Command, version: string): void {
  const pfid = program.command('pfid').description('Generate PFIDs');

  pfid
    .command('generate')
    .description('Generate PFIDs')
    .option('--account_id <account_id>', 'Account ID')
    .option('--count <count>', 'Number of IDs to generate', parsePositiveInt)
    .action(function (this: Command, options: { account_id?: string; count?: number }) {
      return executeAuthed(this, async (apiClient) => {
        const result = await new PfidClient(apiClient).generate(
          options.count ?? 1,
          options.account_id
        );
        printJson(result);
      });
    });

  const bulk = program.command('bulk').description('Execute bulk query and action operations');

  bulk
    .command('execute')
    .description('Execute bulk requests')
    .requiredOption('--items <items>', 'JSON array or @file')
    .action(function (this: Command, options: { items: string }) {
      return executeAuthed(this, async (apiClient) => {
        const items = await parseBulkItems(options.items);
        const result = await new BulkClient(apiClient).execute(items);
        printJson(result);
      });
    });

  const utils = program.command('utils').description('Check templates, schemas, and payloads');

  utils
    .command('render_liquid_template')
    .description('Render a Liquid template against sample payloads')
    .requiredOption('--template <template>', 'Liquid template string, or @path to a file')
    .requiredOption(
      '--samples <samples>',
      'JSON array of { payload, result_payload? } objects, or @path to a JSON file'
    )
    .action(function (this: Command, options: { template: string; samples: string }) {
      return executeAuthed(this, async (apiClient) => {
        const template = await readTextOption(options.template, '--template');
        const samples = await parseTemplateSamples(options.samples);
        printJson(await new UtilsClient(apiClient).renderLiquidTemplate(template, samples));
      });
    });

  utils
    .command('validate_schema')
    .description('Validate a JSON Schema and an optional payload')
    .requiredOption('--schema <schema>', 'JSON Schema object, or @path to a JSON file')
    .option(
      '--payload <payload>',
      'JSON object, null to validate the schema alone, or @path to a JSON file'
    )
    .action(function (this: Command, options: { schema: string; payload?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const schema = await parseJsonOption<Record<string, unknown>>(
          options.schema,
          '--schema',
          'object'
        );
        const payload =
          options.payload === undefined
            ? undefined
            : await parseJsonOption<Record<string, unknown> | null>(
                options.payload,
                '--payload',
                'object-or-null'
              );
        printJson(await new UtilsClient(apiClient).validateSchema(schema, payload));
      });
    });

  utils
    .command('process_sensitive_payload')
    .description('Process a $sensitive payload and check its input and output')
    .requiredOption(
      '--payload <payload>',
      'JSON object in $sensitive wire form, or @path to a JSON file'
    )
    .option(
      '--schema <schema>',
      'JSON Schema object, null to skip the schema check, or @path to a JSON file'
    )
    .action(function (this: Command, options: { payload: string; schema?: string }) {
      return executeAuthed(this, async (apiClient) => {
        const payload = await parseJsonOption<Record<string, unknown>>(
          options.payload,
          '--payload',
          'object'
        );
        const schema =
          options.schema === undefined
            ? undefined
            : await parseJsonOption<Record<string, unknown> | null>(
                options.schema,
                '--schema',
                'object-or-null'
              );
        printJson(await new UtilsClient(apiClient).processSensitivePayload(payload, schema));
      });
    });

  program
    .command('ping')
    .description('Verify the selected or supplied API token')
    .option('--api-token <apiToken>', 'API token to verify')
    .option('--api-url <apiUrl>', 'API URL to use with --api-token')
    .action(function (this: Command, options: { apiToken?: string; apiUrl?: string }) {
      if (options.apiToken) {
        const apiUrl = options.apiUrl ?? process.env.PREFACTOR_API_URL ?? DEFAULT_BASE_URL;
        const apiClient = new ApiClient(apiUrl, options.apiToken);

        return apiClient.request('/ping', { method: 'GET' }).then(printJson);
      }

      return executeAuthed(this, async (apiClient) => {
        const result = await apiClient.request('/ping', { method: 'GET' });
        printJson(result);
      });
    });

  program
    .command('version')
    .description('Print CLI version')
    .action(() => {
      console.log(version);
    });
}
