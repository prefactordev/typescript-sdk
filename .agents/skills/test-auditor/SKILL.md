---
name: test-auditor
description: >-
  Review proposed or newly written tests for relevance, behavioral value, and
  maintainability. Use when Codex writes tests, reviews test diffs, receives
  feedback that tests are unnecessary, or needs to detect "bullshit tests":
  tests outside scope, tests written only for coverage, tests for
  impossible/unrealistic cases, tests coupled to implementation details, stale
  tests that should be removed, or tests adjacent to but not required by the
  feature.
---

# Test Auditor

## Mission

Audit tests as product-quality code. Keep tests that protect realistic behavior in the current scope. Remove or reject tests that exist only to satisfy a testing ritual.

Use this skill after writing tests, while reviewing a test diff, or before recommending new tests.

## Audit Workflow

1. Identify the feature or behavior under change.
2. List the observable behaviors that need protection.
3. Classify the code under test:
   - `trivial`: pure plumbing, simple delegation, type-only behavior, or no meaningful branching.
   - `domain`: business rule, algorithm, parser, serializer, lifecycle behavior, or meaningful state transition.
   - `controller`: orchestration with many collaborators and little logic.
   - `overcomplicated`: high complexity plus many collaborators; recommend refactoring before broad unit tests.
4. Review each test against the behavior list.
5. Mark tests as keep, revise, or remove.
6. Check whether stale tests should be deleted because the feature changed or was replaced.

## Reject Bullshit Tests

Flag a test for removal or rewrite when it:

- Tests behavior outside the current feature scope.
- Tests an adjacent behavior that is not changed and not a realistic regression risk.
- Tests an impossible or incredibly unlikely scenario without a concrete product or production reason.
- Exists only because a regression test "sounds responsible" when the team knows that compatibility or behavior is not needed.
- Mirrors implementation details, private helpers, internal fields, exact method calls, or internal data structures.
- Would fail under a harmless refactor that preserves user-visible behavior.
- Uses mocks inside the domain boundary instead of real domain objects/value types.
- Asserts mock choreography rather than observable outcomes.
- Replaces a stale test by adding a new one without removing the obsolete expectation.
- Tests behavior already guaranteed by the type system unless there is a runtime contract at stake.
- Only asserts that an obsolete or unsupported output is not returned, instead of asserting the
  current positive contract. Example: if the behavior is "Paris is in France", do not keep a test
  whose only value is "does not answer Germany" unless "Germany" is a realistic product regression.

## Keep Valuable Tests

Prefer tests that:

- Express a business rule or user-visible behavior in the test name.
- Use public APIs or observable boundaries.
- Assert returned values, public state, persisted records, emitted events, sent messages, or other externally meaningful effects.
- Cover realistic bugs in domain logic, algorithms, lifecycle handling, serialization, or state transitions.
- Run quickly without unnecessary I/O or infrastructure.
- Remain stable when internals are refactored.
- Use fakes or mocks only at external system boundaries, and only to verify meaningful outcomes.

## Testing Philosophy

Treat a unit as a unit of behavior, not a class or function. A non-technical stakeholder should be able to understand what a test protects from its name and assertions.

Prioritize detail for `domain` code. Use only a few high-level tests for `controller` code. Call out `trivial` code that does not need dedicated unit tests. For `overcomplicated` code, suggest extracting deeper domain units before adding a broad test suite.

When a feature replaces or changes another feature, remove or update stale tests instead of preserving outdated expectations beside new ones.

Prefer positive contract assertions over broad negative assertions. A negative assertion is worth
keeping only when the excluded output is a documented edge case, a realistic regression, or a
security/business invariant.

## Output Contract

When auditing tests, respond with:

1. A short summary of the behaviors identified.
2. Findings, ordered by severity, with file/line references when available. For each finding, say `keep`, `revise`, or `remove`.
3. A brief explanation covering:
   - the category of the code under test (`trivial`, `domain`, `controller`, or `overcomplicated`);
   - how the retained tests satisfy the four pillars: protection against realistic regressions, resistance to refactoring, fast feedback, and maintainability;
   - tests intentionally not written or recommended for removal, and why.

When asked to write tests rather than audit existing tests, first summarize the behaviors and then provide only tests that pass this audit. After the code, include the brief explanation above.
