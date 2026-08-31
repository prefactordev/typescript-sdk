---
name: branch-audit
description: Audit all changes on the current branch for security, performance, correctness, schema, style, public API, and dependency issues. Use when the user asks to audit or review the branch.
---

# Branch audit

**Location (this repo):** `.agents/skills/branch-audit/SKILL.md`.

Perform a comprehensive code review of every change on the current feature branch relative to `main`, organized by severity and category.

## When to use

- User asks to "audit", "review", or "check" the current branch.
- User asks for a security/performance/style review of recent changes.

## Prompt template (what the user typically says)

> Do an audit of the changes in this branch and present the results as the plan -- include any things that you think need to be fixed. Look at issues like security, performance and style.

## Workflow

### 1. Switch to plan mode

The audit output is a plan, so switch to plan mode before starting. The analysis is read-only; emit the audit via `CreatePlan`, with one plan todo per finding.

### 2. Gather scope

Audit the entire branch by default; narrow the scope and the git ranges to specific commits only when the user names them.

Run these three git commands **in parallel** to understand the branch:

```bash
git branch --show-current
git log --oneline main..HEAD
git diff main...HEAD --stat
```

This tells you the branch name, commit history, and which files changed.

### 3. Read the intent

Read what the branch is meant to do, so you can tell intended behavior from bugs and spot scope creep or missing work:

- **PR description:** `gh pr view` shows the open PR's title and body. Skip if no PR exists yet for the branch or `gh` is not available.
- **Branch name and commits:** the branch slug and the commit subjects from step 2 are the primary statement of intent.
- **Package guidance:** read the `AGENTS.md` of every package the branch touches (`packages/<pkg>/AGENTS.md`); it states the package's purpose and architecture rules, which the branch must respect.

The diff is authoritative for what changed; this context only frames what the branch set out to do. Use it to flag gaps between stated intent and the actual changes, not to excuse a real issue.

If the work on the branch conflicts with the PR description, then highlight this in the plan.

### 4. Read project standards

Read the root `AGENTS.md` in full — it carries the coding rules, tracing and context rules, schema and template rules, transport and queue conventions, and changeset requirements — plus the package-level `AGENTS.md` for each changed package. Findings should be grounded in those rules, not generic opinions.

### 5. Explore changes in parallel

Launch **parallel explore subagents** (read-only), one per package area that the branch actually touches. Only launch a pass whose area has changed files. For a typical branch, split into:

| Subagent | Scope |
|----------|-------|
| Core infra | `packages/core` - tracing, span lifecycle, transport, queue, config, serialization, span schemas |
| Adapters | `packages/ai`, `packages/langchain`, `packages/livekit`, `packages/claude`, `packages/openclaw-prefactor-plugin` - provider instrumentation, middleware, streaming handlers |
| CLI | `packages/cli` - API clients, commands, output types, install scripts |

Give each subagent the prompt below, filling in its area:

```text
You are one of several parallel subagents auditing the current branch against `main`. Your area: <area from the table above>.

- Run `git diff main...HEAD --name-only` to list the branch's changed files and work out which ones fall in your area. Review those hunks with `git diff main...HEAD -- <files>`, not just the current file contents. Do not report issues the branch did not introduce.
- Your area includes the tests covering its code (`packages/<pkg>/tests` mirrors `src/`); review them too.
- Read the changed files in your area thoroughly, plus anything they depend on that you need to understand the change.
- Read the root `AGENTS.md` and the `AGENTS.md` of each package in your area. Ground findings in those rules.
- Report issues with file paths and line numbers across these categories:
  - **Security** (`S`): credential or token leakage, secrets in span payloads or logs, unsafe deserialization, unsanitized CLI input
  - **Performance** (`P`): blocking the single-threaded queue, unbounded payloads without `serializeValue`/`truncateString`, heavy synchronous work in instrumentation hot paths
  - **Correctness** (`C`): logic bugs, broken `AsyncLocalStorage` context propagation, span lifecycle mismatches (start without finish, double finish), streaming spans not finished on completion or cancel, instrumentation throwing instead of logging and continuing, wrapped user code not rethrowing the original error
  - **Schemas/templates** (`SC`): span payload or result key changes without schema coordination, templates referencing fields the instrumentation does not populate, duplicate canonical schema entries for one span type, dropped default result schemas
  - **Style** (`ST`): violations of the root or package `AGENTS.md` (kebab-case file names, `any` without a biome-ignore justification, missing explicit return types on public APIs, empty try-catch, speculative or dead code, public exports missing from `src/index.ts`)
  - **Test quality** (`T`): coverage gaps in lifecycle or side-effect behavior, tests for behavior the type system already guarantees (forbidden by root `AGENTS.md`), weak assertions, flaky async-context test risks
- For each finding give: the category prefix, a proposed severity (High blocks merge, Medium should be fixed, Low is optional), the file path with line number, and a brief explanation of the problem.
- Ground findings in the project's standards, not generic best practice. Do not report anything you cannot tie to a file path and line number. Do not fix anything.
- If you find nothing in your area, say so explicitly.
```

Add two specialist passes as **general-purpose subagents** (they need command and web access) when the branch touches their trigger files.

**API contract** - trigger: contract types in `packages/core/src` or clients/commands/types in `packages/cli/src` changed on the branch.

```text
You are the API contract subagent auditing the current branch against `main`.

- Run `git diff main...HEAD -- packages/core/src packages/cli/src` and identify every change to a type, client method, or command that sends fields to or reads fields from the Prefactor API.
- Read `.agents/skills/api-drift/SKILL.md` and the comparison rules in `.agents/skills/api-drift/reference.md`. Apply them, but scope yourself to the endpoints and schemas the branch touches - this is a branch audit, not a full drift run.
- Fetch the production spec and digest it per the api-drift skill (`curl -s https://app.prefactorai.com/api/v1/openapi -o /tmp/prefactor-openapi.json`, then the digest script). If the fetch fails, say so and fall back to reviewing the branch's contract changes for internal consistency only.
- Report each breaking or possibly breaking delta the branch introduces as a finding: category `API`, severity (breaking is High, possibly breaking is Medium unless clearly benign), the endpoint/schema, and why clients or the backend break.
- List non-breaking deltas separately; the lead files them under "Noted but acceptable".
- Do not fix anything.
```

**Dependencies** - trigger: any `package.json` or `bun.lock` changed on the branch.

```text
You are the dependencies subagent auditing the current branch against `main`.

- Run `git diff main...HEAD -- '**/package.json' bun.lock` to list added, removed, and bumped packages with old and new versions.
- For each added or bumped package, read the upstream changelog or GitHub releases for every version after the old one up to the new one. Find the source repo from the package's npm page.
- Report likely issues as findings: category `DEP`, severity, package and version range, and the changelog entry behind the concern. Cover breaking changes, behavioural changes that affect how this codebase uses the package, deprecations of features in use, and engine requirement changes (compare against the node and bun versions in `.mise.toml`).
- For routine bumps (fixes, docs, internal changes), give a one-line no-issue note instead of a finding.
- Do not fix anything.
```

Design (`D`) covers cross-cutting architecture: package boundary violations, shared logic added to an adapter that belongs in `packages/core`, wrong dependency direction between packages, a change to shared behavior that was not made in the shared implementation first. It is lead-only - per-package scope hides the cross-cutting view those judgements need, so you make that pass in step 6. The category prefixes become the finding identifiers in the plan headings. Check the step 2 diff stat for changed files no pass covers (`scripts/`, `examples/`, `docs/`, `.github/`, root configs, `.changeset/`) and review those yourself.

### 6. Verify findings and assess design

After subagents return, **read specific lines** for the most important findings to confirm they are real (not hallucinated). Focus on medium+ severity items.

Make the Design (`D`) pass yourself: judge the branch as a whole against the shared-first philosophy and package roles in the root `AGENTS.md` and the package-level architecture rules.

Make the Release (`REL`) pass yourself: run `bunx @changesets/cli status --since=origin/main`. Every release-worthy package change needs a changeset at the right bump level (`patch` for fixes, `minor` for backward-compatible features, `major` for breaking changes). Missing changesets, wrong bump levels, and intentional `@prefactor/cli` changes without a changeset (which gate binary releases) are findings; docs-only or test-only changes are not.

### 7. Present findings as a plan

Always present the audit as a plan, never as a plain reply. Emit the plan through the platform's plan mechanism (`CreatePlan` in Cursor), mapping one plan todo per finding. Structure the document per "Structure of the audit document" below.

Follow the repo's review rules:
- Use file paths with line numbers.
- Focus on bugs, regressions, risks, standards violations, and missing tests.

If there are no findings, say so explicitly and mention any residual testing or review gaps.

## What NOT to do

- Do not fix anything during the audit — this is read-only analysis.
- Do not flag pre-existing issues unrelated to the branch's changes.
- Do not report generic best-practice advice; ground findings in the project's own standards.
- Do not report issues you cannot verify with a file path and line number.
- This is a public repo: do not reference internal Prefactor code, repos, or tooling in the audit or its fix prompts.

## Structure of the audit document

````markdown
# Branch audit: <branch name>

## Run all findings

To fix every finding in one session, paste this prompt:

```
Work through every finding in this audit, in order. For each one: fix it following its prompt block, run `bun run build`, `bun test`, `bun run typecheck`, and `bun run lint` and make them pass, then pause and wait for my feedback or an instruction to commit. Commit only when I tell you to, then move on to the next finding.
```

## Findings

### <finding identifier> - <one-line title> (<severity>)

[`path/to/file.ts:42`](path/to/file.ts)

<brief explanation of the issue and why it matters>

```
<imperative fix goal>

<Suggested solution, one or two sentences; omit only if no solution is clear>

Work in <files and packages it touches>

Add or update tests if the fix changes behavior, and add a changeset if it changes a publishable package.
Do not create a commit. Do not edit the audit plan; it stays fixed while you work on this finding.
```

<... one finding block per finding, ordered by severity ...>

## Noted but acceptable

- <identifier> - <one-line reason; no fix prompt>

## Overview

<brief summary>
````

- The finding heading carries the category prefix and a sequence number (for example `S1`, `ST2`), a one-line title, and severity (`High`, `Medium`, `Low`).
- The file path is a markdown link with line references when possible.
- The fenced block is a ready-to-paste agent prompt that fixes this one finding in a fresh session. Keep it self-contained: state the fix goal, a brief suggested solution, and the files and packages it touches, so it runs without the rest of the audit for context. Omit the suggested solution only when no solution is clear.
- "Noted but acceptable" covers issues the audit judges acceptable (for example, an intentional breaking change with a `major` changeset) and findings the user accepts during review; for the latter, also cancel the matching plan todo.
- The "Run all findings" block at the top of the document is a ready-to-paste prompt for fixing every finding in one session; omit it when the audit has no findings.
