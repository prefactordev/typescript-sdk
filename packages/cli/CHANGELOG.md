# @prefactor/cli

## 0.3.0

### Minor Changes

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add agent instance terminate (`POST /api/v1/agent_instance/{id}/terminate`) to the core client and CLI.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add CLI admin user update for PUT /api/v1/admin_user/{id}.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add CLI retrieve for GET /api/v1/agent_spans/{id}.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add CLI alerts client and commands for list, retrieve, count, raise, and clear.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add CLI discard_sensitive for POST /api/v1/agent_spans/{id}/discard_sensitive.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add CLI person client and commands for list, create, retrieve, update, and delete.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add CLI playground client and commands for all playground create, record, and register operations.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add CLI risk_profile client and commands including template lookup.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add CLI show lookups for agent, agent instance, and environment.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Add CLI team client and commands for list, create, retrieve, update, and delete.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Align CLI list responses with the spec `summaries` / pagination / sorting envelope, and type PFID generate as a top-level `{ account_id, pfids, status }` payload.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Require spec-mandated CLI output fields (still nullable where the spec uses `| null`). This is a TypeScript break for mock or partial constructors of those response types.

  Bump is minor, not major: `@prefactor/cli` is 0.x (a major changeset would publish 1.0.0), and this is a compile-time type tightening.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Require span-create schema_name and status, stop sending current_version_id on agent update, and restrict agent instance finish status to complete, failed, or cancelled.

  Bump is minor, not major: `@prefactor/cli` is 0.x (a major changeset would publish 1.0.0). This is a CLI request-contract break, same level as the bulk rewrite.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Remove the `agent_spans create_test_spans` command. That path is not in the OpenAPI spec.

  Bump is minor, not major: `@prefactor/cli` is 0.x (a major changeset would publish 1.0.0). Command removal is a 0.x contract break, same level as the bulk rewrite.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Point CLI bulk execute at the spec `_type` / `idempotency_key` request items and `outputs` response. Method/path bulk items are no longer accepted.

  Bump is minor, not major: `@prefactor/cli` is 0.x (a major changeset would publish 1.0.0). This is the intended level for CLI contract breaks on this branch.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Type agent schema version retrieve details with SchemaDetails, SchemaValidationResult, and SpanTypeSchemaDetails nested output schemas.

### Patch Changes

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Move agent instance show onto AgentInstanceClient.show and stop exporting the standalone showAgentInstance helper.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Align agent instance register and span create client types with the OpenAPI contract. Register now types optional `id`, `update_current_version`, and instance-level `external_identifier`; span create requires a string `agent_instance_id` and accepts `cancelled` status.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Accept `null` on admin_users update `--job_title` and `--profile_completed_at` so those nullable fields can be cleared.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Type playground register-instance responses with AgentSchemaVersionDetails and AgentVersionDetails, matching the production spec.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Reject pagination offsets that contain trailing characters or decimal portions instead of truncating them with parseInt.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Tighten AgentSpan retrieve status to the same active | complete | failed | cancelled union used by AgentSpanSummary.

- [#70](https://github.com/prefactordev/typescript-sdk/pull/70) [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a) Thanks [@simonrussell](https://github.com/simonrussell)! - Validate `agent_spans finish --status` against complete, failed, and cancelled so invalid values like `finished` fail at the CLI instead of reaching the API.

- Updated dependencies [[`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a), [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a), [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a), [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a), [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a), [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a), [`666f24c`](https://github.com/prefactordev/typescript-sdk/commit/666f24ca9347bc12e8957eb1bed56977659d6c4a)]:
  - @prefactor/core@1.2.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`3cc5275`](https://github.com/prefactordev/typescript-sdk/commit/3cc527593726818214bdb4fb4c80f592c18dc8cb)]:
  - @prefactor/core@1.1.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`f768847`](https://github.com/prefactordev/typescript-sdk/commit/f768847fa1d1c79a239553cb7e8cf1111554da49), [`83a3c2f`](https://github.com/prefactordev/typescript-sdk/commit/83a3c2f36366be0021dba16d90799a9ec9e3b782)]:
  - @prefactor/core@1.0.0

## 0.2.0

### Minor Changes

- [#57](https://github.com/prefactordev/typescript-sdk/pull/57) [`cbd9aa0`](https://github.com/prefactordev/typescript-sdk/commit/cbd9aa0586893a57b7cb16a04df47da2e89c2d28) Thanks [@Siutan](https://github.com/Siutan)! - Add agent create options, token validation, and JSON output to `prefactor setup`. Setup prints credentials only; package selection is left to the caller.

## 0.1.6

### Patch Changes

- [#53](https://github.com/prefactordev/typescript-sdk/pull/53) [`61f85dd`](https://github.com/prefactordev/typescript-sdk/commit/61f85dd4432a56658e267beca43d126f1634a07d) Thanks [@Siutan](https://github.com/Siutan)! - Stop creating agent deployments manually in `prefactor setup`. Setup now resolves an environment and creates a deployment-scoped token; the backend creates the deployment when the token is issued if one does not already exist.

## 0.1.5

### Patch Changes

- [#54](https://github.com/prefactordev/typescript-sdk/pull/54) [`f74b890`](https://github.com/prefactordev/typescript-sdk/commit/f74b890de563becb24f3f3e4c74acf43a1b045d8) Thanks [@Siutan](https://github.com/Siutan)! - Add package `repository` metadata so npm provenance validation succeeds on publish.

- Updated dependencies [[`f74b890`](https://github.com/prefactordev/typescript-sdk/commit/f74b890de563becb24f3f3e4c74acf43a1b045d8)]:
  - @prefactor/core@0.5.1

## 0.1.4

### Patch Changes

- Updated dependencies [[`0e9b675`](https://github.com/prefactordev/typescript-sdk/commit/0e9b67519e6a538d9cf09218e75e006387f917b8)]:
  - @prefactor/core@0.5.0
