import { type Command, Option } from 'commander';
import { LlmProviderClient, type LlmProviderKind } from '../clients/llm-provider.js';
import {
  LlmProviderModelClient,
  type LlmProviderModelForUpdate,
} from '../clients/llm-provider-model.js';
import { executeAuthed, printJson, readTextOption, validateOptionalPfid } from './shared.js';

const PROVIDER_KINDS: LlmProviderKind[] = [
  'anthropic',
  'openai',
  'ollama_cloud',
  'together',
  'custom_openai',
];

/** Register commands for the language model providers and models that hosted judges run on. */
export function registerLlmProvidersCommands(program: Command): void {
  const providers = program
    .command('llm_providers')
    .description('Manage language model providers for hosted judges');

  providers
    .command('list')
    .description('List LLM providers')
    .option('--account_id <account_id>', 'Account ID')
    .action(function (this: Command, options: { account_id?: string }) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new LlmProviderClient(apiClient).list(options));
      });
    });

  providers
    .command('retrieve <id>')
    .description('Retrieve an LLM provider')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new LlmProviderClient(apiClient).retrieve(id));
      });
    });

  providers
    .command('create')
    .description('Create an LLM provider')
    .requiredOption('--name <name>', 'Provider name, unique in the account')
    .addOption(
      new Option('--provider <provider>', 'Provider type')
        .choices(PROVIDER_KINDS)
        .makeOptionMandatory()
    )
    .requiredOption('--api_key <api_key>', 'API key, or @path to read it from a file')
    .option('--api_base_url <url>', 'Endpoint URL; required for custom_openai')
    .option('--account_id <account_id>', 'Account ID')
    .option('--id <id>', 'LLM provider ID')
    .action(function (
      this: Command,
      options: {
        name: string;
        provider: LlmProviderKind;
        api_key: string;
        api_base_url?: string;
        account_id?: string;
        id?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');
        printJson(
          await new LlmProviderClient(apiClient).create({
            name: options.name,
            provider: options.provider,
            api_key: (await readTextOption(options.api_key, '--api_key')).trim(),
            ...(options.api_base_url ? { api_base_url: options.api_base_url } : {}),
            ...(options.account_id ? { account_id: options.account_id } : {}),
            ...(options.id ? { id: options.id } : {}),
          })
        );
      });
    });

  providers
    .command('update <id>')
    .description('Update an LLM provider; the provider type cannot change')
    .option('--name <name>', 'Provider name')
    .option('--api_key <api_key>', 'New API key, or @path to read it from a file')
    .option('--api_base_url <url>', 'Endpoint URL of a custom_openai provider')
    .action(function (
      this: Command,
      id: string,
      options: { name?: string; api_key?: string; api_base_url?: string }
    ) {
      return executeAuthed(this, async (apiClient) => {
        if (
          options.name === undefined &&
          options.api_key === undefined &&
          options.api_base_url === undefined
        ) {
          throw new Error(
            'No fields provided to update. Specify --name, --api_key, or --api_base_url.'
          );
        }
        printJson(
          await new LlmProviderClient(apiClient).update(id, {
            ...(options.name !== undefined ? { name: options.name } : {}),
            ...(options.api_key !== undefined
              ? { api_key: (await readTextOption(options.api_key, '--api_key')).trim() }
              : {}),
            ...(options.api_base_url !== undefined ? { api_base_url: options.api_base_url } : {}),
          })
        );
      });
    });

  providers
    .command('delete <id>')
    .description('Delete an LLM provider and its models')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new LlmProviderClient(apiClient).delete(id));
      });
    });

  const models = program
    .command('llm_provider_models')
    .description('Manage the models available through an LLM provider');

  models
    .command('list')
    .description('List the models of an LLM provider')
    .requiredOption('--llm_provider_id <llm_provider_id>', 'LLM provider ID')
    .action(function (this: Command, options: { llm_provider_id: string }) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new LlmProviderModelClient(apiClient).list(options.llm_provider_id));
      });
    });

  models
    .command('retrieve <id>')
    .description('Retrieve an LLM provider model')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new LlmProviderModelClient(apiClient).retrieve(id));
      });
    });

  models
    .command('create')
    .description(
      'Add a model. For named providers, Prefactor fills in the name and pricing from models.dev'
    )
    .requiredOption('--llm_provider_id <llm_provider_id>', 'LLM provider ID')
    .requiredOption('--api_name <api_name>', 'Model name the provider API expects')
    .option('--name <name>', 'Display name; required for custom_openai')
    .option('--models_dev_provider <provider>', 'models.dev provider, for custom_openai pricing')
    .option('--models_dev_model_name <name>', 'models.dev model name, for custom_openai pricing')
    .option('--id <id>', 'LLM provider model ID')
    .action(function (
      this: Command,
      options: {
        llm_provider_id: string;
        api_name: string;
        name?: string;
        models_dev_provider?: string;
        models_dev_model_name?: string;
        id?: string;
      }
    ) {
      return executeAuthed(this, async (apiClient) => {
        validateOptionalPfid(options.id, '--id');
        printJson(
          await new LlmProviderModelClient(apiClient).create({
            llm_provider_id: options.llm_provider_id,
            api_name: options.api_name,
            ...(options.name ? { name: options.name } : {}),
            ...(options.models_dev_provider
              ? { models_dev_provider: options.models_dev_provider }
              : {}),
            ...(options.models_dev_model_name
              ? { models_dev_model_name: options.models_dev_model_name }
              : {}),
            ...(options.id ? { id: options.id } : {}),
          })
        );
      });
    });

  models
    .command('update <id>')
    .description('Update an LLM provider model')
    .option('--api_name <api_name>', 'Model name the provider API expects')
    .option('--name <name>', 'Display name')
    .option('--models_dev_provider <provider>', 'models.dev provider')
    .option('--models_dev_model_name <name>', 'models.dev model name')
    .action(function (this: Command, id: string, options: LlmProviderModelForUpdate) {
      return executeAuthed(this, async (apiClient) => {
        const details: LlmProviderModelForUpdate = {
          ...(options.api_name !== undefined ? { api_name: options.api_name } : {}),
          ...(options.name !== undefined ? { name: options.name } : {}),
          ...(options.models_dev_provider !== undefined
            ? { models_dev_provider: options.models_dev_provider }
            : {}),
          ...(options.models_dev_model_name !== undefined
            ? { models_dev_model_name: options.models_dev_model_name }
            : {}),
        };
        if (Object.keys(details).length === 0) {
          throw new Error(
            'No fields provided to update. Specify --api_name, --name, --models_dev_provider, or --models_dev_model_name.'
          );
        }
        printJson(await new LlmProviderModelClient(apiClient).update(id, details));
      });
    });

  models
    .command('delete <id>')
    .description('Delete an LLM provider model')
    .action(function (this: Command, id: string) {
      return executeAuthed(this, async (apiClient) => {
        printJson(await new LlmProviderModelClient(apiClient).delete(id));
      });
    });
}
