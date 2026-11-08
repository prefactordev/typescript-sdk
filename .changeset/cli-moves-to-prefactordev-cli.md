---
"@prefactor/cli": patch
---

This is the last release of the TypeScript CLI. The Prefactor CLI now lives at [prefactordev/cli](https://github.com/prefactordev/cli), and `prefactor update` on this version installs it in place, keeping your profiles in `~/.prefactor/prefactor.json`. Installs older than this release reach it after two updates. `prefactor update --version` now only accepts versions released from prefactordev/cli (0.8.0 and later).

The new CLI uses kebab case for every command and option with more than one word, with no snake case aliases. Update scripts and agent prompts that call the CLI:

- Command groups: `admin_user_invites`, `admin_users`, `agent_associations`, `agent_deployments`, `agent_instance_associations`, `agent_instances`, `agent_schema_versions`, `agent_spans`, `agent_versions`, `api_tokens`, `knowledgebase_document_revisions`, `knowledgebase_documents`, `knowledgebase_revisions`, `llm_provider_models`, `llm_providers` and `risk_profiles` become `admin-user-invites`, `admin-users`, `agent-associations` and so on.
- Subcommands: `list_from`, `list_to`, `list_promotions`, `agent_context`, `discard_sensitive`, `record_quality`, `create_version`, `list_documents`, `render_liquid_template`, `validate_schema` and `process_sensitive_payload` become `list-from`, `list-to`, `list-promotions`, `agent-context`, `discard-sensitive`, `record-quality`, `create-version`, `list-documents`, `render-liquid-template`, `validate-schema` and `process-sensitive-payload`.
- Options: every option with an underscore, such as `--agent_id`, `--pagination_page_size`, `--sort_field` and `--start_time`, becomes `--agent-id`, `--pagination-page-size`, `--sort-field` and `--start-time`.
- The `playground` command is removed.

For example, `prefactor agent_instances list --agent_id <id>` becomes `prefactor agent-instances list --agent-id <id>`.
