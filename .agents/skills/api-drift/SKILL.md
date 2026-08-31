---
name: api-drift
description: Compares the canonical production Prefactor OpenAPI spec against the hand-written API contracts in packages/core and packages/cli, and emits the required changes as a staged roadmap of commit-sized agent prompts. Use when the backend API or OpenAPI spec changed, when checking for API drift or contract sync, or when the user asks what needs to change in the core SDK or CLI to match the backend.
disable-model-invocation: true
---

## Fetch the spec

The spec comes from the canonical production endpoint — never from a local file, checkout, or branch:

```bash
curl -s https://app.prefactorai.com/api/v1/openapi -o /tmp/prefactor-openapi.json
```

Verify the download is the spec (`jq -e '.paths' /tmp/prefactor-openapi.json`); if the fetch fails, stop and tell the user. The spec is the whole contract: if it does not answer a question about the backend, mark the claim as unverified in the roadmap stage and give the executor a verification step.

## Document every gap — completeness is the point

The entire purpose of this skill is a complete account of what the SDK/CLI is missing or mismatching. A run that silently omits findings is a failed run, worse than no run at all.

- Compare exhaustively. Every operation in the digest's operations index and every schema in the schema index must end up accounted for in working notes: matched, breaking drift, mismatch, coverage gap, or documented omission. Do not sample, do not stop early, do not skip entries that look uninteresting.
- New spec operations (actions) with no SDK/CLI caller and new spec schemas (datatypes) with no SDK/CLI type are exactly what the user runs this skill to find. Never drop them from working notes, never collapse undocumented gaps into a count.
- Every undocumented difference is listed with a fix. There is no "intentionally unused, skip it" bucket controlled by the agent.
- Never declare a gap intentional yourself. The only source of intent the agent may honor is SDK/CLI documentation that states the omission is deliberate (quote file + sentence). Classify that entry as a documented omission: account for it in working notes, include it in the Spec state count, and do not put it in the coverage-gap list, emit a stage or todo, or attach a closing recipe. All other gaps stay in the coverage-gap list with no intent judgement — what is intentionally omitted among those is the user's decision at roadmap review.
- A practical technique: copy the full operations index and schema index into your working notes and mark every single entry before writing the roadmap.

## Digest the spec

Run from the repo root (use `mise exec -- bun` if `bun` is not on PATH):

```bash
bun .agents/skills/api-drift/scripts/digest-openapi.ts /tmp/prefactor-openapi.json
```

This prints an operations index, per-operation request/response shapes, and a schema index. Read the digest, not the raw spec.

## Inventory current contracts

Inventory the current contracts yourself with targeted searches, for example:

```bash
rg -n "api/v1" packages/core/src
rg -n "client.request\(" packages/cli/src/clients packages/cli/src/commands
```

Contracts are hand-written TypeScript; there is no codegen. Read [reference.md](reference.md) for the quirks and comparison rules before comparing.

## Compare

Apply the comparison rules in [reference.md](reference.md): path-param normalization, nullable/optional handling, envelope conventions, error-code comparison, and request/response dependence (only fields the SDK actually sends or reads count). For every SDK/CLI endpoint, find its spec operation and check each sent field and each read response field. For every spec operation, check whether the SDK/CLI calls it. For every spec schema, check whether the SDK/CLI models it (client interfaces in `packages/cli/src/clients/`, contract types in `packages/core/src/`). Both directions of both checks are mandatory.

## Classify findings

- **Breaking drift** — the SDK/CLI relies on something the spec removed or changed incompatibly: missing path, missing or renamed field, narrowed type, or a new required field the SDK never sends.
- **Contract mismatch** — a real difference on a shared endpoint that is not breaking: envelope differences, type widening, optional/required flips in the compatible direction.
- **Coverage gap** — a spec endpoint with no SDK/CLI caller, or a spec schema with no SDK/CLI type, and the SDK/CLI docs do not state the omission is deliberate. Every such difference is listed with a fix: each gap appears by name in the roadmap's coverage-gap list with the concrete steps to close it (per the recipes in reference.md). Attach no intent judgement.
- **Documented omission** — a spec endpoint or schema with no SDK/CLI caller/type, where SDK/CLI docs state the omission is deliberate (quote file + sentence in working notes). Accounted, not staged: include it in the Spec state count only. Do not name it in Coverage gaps or Stages. Do not attach a closing recipe. See [reference.md](reference.md) for the canonical example.

Every finding must cite both sides: spec evidence (path, field, shape from the digest) and code evidence (file, what it sends or reads).

## Decompose into stages

- One stage = one coherent commit. If two changes must land together to keep the build and tests green, they are one stage.
- Order by dependency: core contract changes before CLI changes that consume them; breaking drift and mismatches before coverage gaps.
- Coverage gaps get stages too — one stage per resource or coherent unit, built from the closing recipes in reference.md. Each gap stage names the exact files to create or extend, the types to add with the spec-derived shapes inline, the command wiring for CLI resources, tests, and a changeset. Documented omissions do not get stages, todos, or closing recipes. A future pass that sees `POST /api/v1/account/{id}/implode` plus the AGENTS.md sentences in [reference.md](reference.md) must not create a coverage-gap entry or a stage for it.
- Write each stage as a ready-to-paste agent prompt with the spec evidence inline (endpoint, field, expected shape) and the files it touches. For any claim about existing code the analysis could not verify, name the claim in the prompt, give the executor the verification step, and tell it to stop and report to the user if the claim is false. Detailed test strategy stays deferred to the per-stage planning pass.
- Each stage prompt carries the AGENTS.md release rules that apply to it: a changeset for every release-worthy package change, and tests added or updated when behavior changes.

## Switch to plan mode

The analysis above is read-only. Emit the roadmap via `CreatePlan`, with one plan todo per stage, titled with the stage name.

## Produce the roadmap

Roadmap body shape:

1. **Header note** (first line): "Roadmap, not a task plan. Do not edit this file. Run each stage below as its own prompt in a fresh session that produces its own plan, or run every stage in one session with the run-all prompt below; record progress and changes in the working session, not here."
2. **Run all stages**: right under the header note, a ready-to-paste prompt that runs the whole roadmap in one session:

````markdown
## Run all stages

To run every stage in one session, paste this prompt:

```
Work through every stage in this roadmap, in order. For each one: do the work in its prompt block, run `bun run build`, `bun test`, and `bun run typecheck` and make them pass, then pause and wait for my feedback or an instruction to commit. Commit only when I tell you to, using the stage's commit subject, then move on to the next stage.
```
````

3. **Spec state**: the spec URL, the fetch timestamp, and a one-line drift summary (counts by class: breaking / mismatch / coverage gap / documented omission). Documented omissions appear only as a count here (e.g. "documented omission 1"), never by name.
4. **Coverage gaps**: the complete list, by name, of every undocumented spec operation with no SDK/CLI caller and every undocumented spec schema with no SDK/CLI type. Each entry carries the concrete steps required to close it (files, types, wiring, tests, changeset, per the recipes in reference.md). Do not name documented omissions in this list. For undocumented gaps, attach no intent judgement — the user decides what is intentional at review. This list is mandatory and exhaustive for undocumented gaps; a count or a sample of those is a failed run.
5. **Stages**: numbered list, one entry per stage, each following this template:

````markdown
### 1. <stage title>

```
<imperative goal, with the spec evidence inline: endpoint, field, expected shape>. Work in <files it touches>.

Do not create a commit.
Do not edit the roadmap plan; it stays fixed while you work on this stage.
```

- **Touches**: `packages/core/src/...`, `packages/cli/src/...`
- **Commit**: <subject line of the commit this stage represents>
````

## Non-goals

- Not an implementation pass — each stage gets its own plan later.
- Does not write SDK/CLI code, run non-read tools beyond the spec fetch, or create commits.
