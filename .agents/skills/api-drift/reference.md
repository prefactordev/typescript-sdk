# API contract reference

Non-obvious facts and rules for the drift analysis. The contract inventory itself is trivially discoverable (`rg -n "api/v1" packages/core/src`, `ls packages/cli/src/clients`) and is deliberately not repeated here.

## Quirks that bite during comparison

- Spec body fields are `parameters` with `in: body`; only POST `/api/v1/bulk` uses `requestBody`. The digest handles both.
- Spec nullable is `oneOf: [T, { $ref: Null }]`; the digest collapses it to `T | null`. A schema's `required` may be `null`; the digest marks optionals with `?`.
- Spec path params use resource-specific names (`{agent_span_id}`); the SDK interpolates `{id}`. Normalize path templates by replacing each `{...}` segment with `{}` before comparing.
- Envelope exceptions to `{ details: ... }`: bulk request (`{ items }`), pfid request (top-level fields), api_token create response (`{ details, token }` with `token` at top level), agent_context response (`{ agent_context: { body } }`), list fallback (`{ summaries: [...] }` in setup).
- Core treats 409 with code `invalid_action` as success on span finish, and 409 as success on agent instance finish.
- Span create/finish responses may include `control: { terminate, reason }`; core acts on it.
- The `ApiError` schema's `code` enum is the backend error vocabulary; the SDK classifies mostly on HTTP status and reads `code` only for `invalid_action`.

## Comparison rules

1. **Response dependence:** the SDK only depends on the response fields it actually reads (e.g. `details.id`, `control.terminate`, `details.status`). New or extra spec response fields are not drift; removed or renamed read fields are.
2. **Request dependence:** every field the SDK sends must exist in the spec with a compatible type. Spec-required fields the SDK never sends are drift candidates; spec-optional fields the SDK omits are not.

## Documented omissions

A spec operation or schema with no SDK/CLI caller/type is a **documented omission** only when SDK/CLI docs state the omission is deliberate. Quote the file and the sentence in working notes. Then treat it as accounted: include it in the Spec state count, and do not put it in the coverage-gap list, emit a stage or todo, or attach a closing recipe.

Leave the documenting AGENTS.md notes in place. They are the evidence the next run must honor.

Canonical example:

- **POST `/api/v1/account/{id}/implode`** (`Action.Account.Implode`)
- [packages/cli/AGENTS.md](../../../packages/cli/AGENTS.md): "The CLI does not expose `POST /api/v1/account/{id}/implode`. That endpoint is a destructive account wipe; `AccountClient` and `accounts` commands stay list/retrieve/update only."
- [packages/core/AGENTS.md](../../../packages/core/AGENTS.md): "Do not implement `POST /api/v1/account/{id}/implode`. That endpoint is a destructive account wipe and is not an observability primitive."

A future api-drift pass that sees implode plus those sentences must not create a coverage-gap entry or a stage for it. Do not implement implode.

## Recipes for closing gaps

Standard steps for closing a coverage gap. Gap stages in the roadmap must name these files concretely, with the spec-derived shapes inline.

**New CLI resource (spec resource with no client):**

1. Create `packages/cli/src/clients/<resource>.ts` — thin typed wrapper around `ApiClient`, one method per operation, `{ details }` envelope per the conventions above.
2. Create `packages/cli/src/commands/<resource>.ts` — a `register<Resource>Commands(program)` function following an existing command file.
3. Register it in `packages/cli/src/cli.ts` next to the other `register*Commands(program)` calls.
4. Export the client and its types from `packages/cli/src/index.ts`.
5. Add tests under `packages/cli/tests/` mirroring an existing client's tests.
6. Add a changeset (`minor` — new backward-compatible API).

**New CLI operations on an existing resource:** extend the client and command file, update exports if new types were added, extend tests, changeset (`minor`).

**New core endpoint:** extend or add a client under `packages/core/src/transport/http/`, payload types beside the client, export from `packages/core/src/index.ts`, tests under `packages/core/tests/` with a mock transport, changeset.

**New datatype (spec schema with no SDK/CLI type):** add the interface to the owning client file (CLI) or the relevant contract type file (core). Use `Record<string, unknown>` for truly dynamic payloads per AGENTS.md; never use `additionalProperties: false` in the CLI (per `packages/cli/AGENTS.md`).
