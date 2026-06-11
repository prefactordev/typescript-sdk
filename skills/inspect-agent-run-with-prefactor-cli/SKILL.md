---
name: inspect-agent-run-with-prefactor-cli
description: Use when performing root-cause analysis on a Prefactor agent run — bad output, surprising behavior, high cost, incomplete work, downvotes, or anything worth investigating. Run in the agent's own codebase. User provides agent instance ID (and agent ID if needed).
---

# Inspect Agent Run With Prefactor CLI

Perform root-cause analysis on a specific agent run using Prefactor span data.

## When to use

The user has already decided something in a run is wrong or worth investigating. They paste identifiers and a symptom; your job is to analyze the spans and deliver a **findings report** — what happened, why (through five whys), and where in the codebase it connects.

Do not prescribe fixes or recommended next actions. The human team owns remediation; your output equips their post-mortem with evidence and source locations.

Typical handoff:

- Agent ID (required)
- Agent Instance ID (when listing specific instances or resolving context)
- What went wrong, what surprised them, or what they want explained — may be ambiguous.

## Run in the agent's codebase

Run this skill from the repository that deployed the agent under investigation — not from the Prefactor SDK repo or an unrelated project. Assume you are running in the correct repo and thus have access to the full codebase of the traces.

Spans show runtime behavior. The agent's codebase holds the prompts, tool implementations, schemas, guardrails, and wiring that explain *why* the system behaved that way. Root-cause analysis needs both:

- **Prefactor CLI** — fetch spans, timelines, token use, linked instances.
- **Local source** — read the code and config that produced those spans.

When a span points at a tool call, find that tool's handler in this repo. When an LLM span shows a bloated prompt, find where that context is assembled. When schema fields look wrong or missing, find the registered span types here. Human-factor whys often resolve in this codebase even when spans only show the symptom.

If the workspace does not match the agent that produced the run, say so before drawing conclusions — you may be missing the source of truth for prompts, tools, and schemas.

## RCA philosophy

This skill is for real root-cause analysis, not trigger spotting.

**Trigger vs root cause**

- A **trigger** is the immediate event that made the failure visible: a bad tool result, timeout, hallucinated answer, runaway retry loop.
- A **root cause** is the condition that made that trigger possible and likely to recur.
- Nine times out of ten, "RCA" in the wild stops at the trigger. Do not stop there.

**Human factors**

- Most incidents ultimately involve human factors: unclear prompts, missing guardrails, wrong assumptions in schemas, untested edge cases, operational pressure, incomplete context given to the agent, handoffs without verification.
- Spans show what the system did. They rarely prove why it was built that way or why the agent received bad inputs.
- The local codebase is where those "why" answers usually live — cross-read spans against source, not spans alone.
- Treat technical findings as evidence. The final answer often requires human judgment about intent, process, and ownership.

**Five whys**

- Work through at least five "why" steps from the user-visible symptom down to systemic conditions.
- Question the accepted truth. If spans show "tool returned empty," ask why empty was acceptable, why the agent did not recover, why the prompt did not constrain that failure mode, why nothing caught it earlier.
- Each why must be labeled **confirmed** (span evidence), **inferred** (strong circumstantial), or **hypothesis** (needs human validation).

**What automation is good for here**

- Fetching and organizing span evidence quickly.
- Contradiction checks: what the agent said vs what tools actually returned.
- Timeline reconstruction, token/cost anomalies, payload bloat, retry patterns.
- Hypothesis generation — not hypothesis closure without human input.

Do not treat span data as a substitute for a post-mortem conversation. Use it to make the conversation sharper.

## Inputs

Collect before starting:

- **Agent's repository** — the project that runs the instrumented agent (current workspace should be this repo).
- Prefactor CLI command, usually `prefactor` or a package-manager launcher.
- Profile name or `PREFACTOR_API_URL` / `PREFACTOR_API_TOKEN`.
- Agent ID from the user.
- Agent Instance ID when you need to list instances or disambiguate runs.
- The user's symptom or investigation question.
- Approximate time window, if the profile does not support `agent_context`.

If the user only has an agent ID, list instances and pick the run that matches their time window or description.

## CLI workflow

Start with the context export for the instance under investigation:

```bash
prefactor --profile <profile> agent_instances agent_context <agent-instance-id> --output /tmp/prefactor-agent-context.json
```

If `agent_context` is not available on that profile, use span listing with summaries:

```bash
prefactor --profile <profile> agent_spans list \
  --agent_instance_id <agent-instance-id> \
  --start_time <iso-start> \
  --end_time <iso-end> \
  --include_summaries
```

Read spans in execution order. Build a timeline: user input → agent decisions → LLM calls → tool calls → intermediate outputs → final response.

Note where the user-visible outcome diverged from source data. That divergence point is usually near the trigger, not the root cause.

## Linked instances (optional)

Not every agent delegates work. Some runs are fully self-contained; others spawn subagents, jobs, or linked runs. Treat linked instances as conditional follow-up, not a required step.

Follow linked runs only when span payloads point to another instance that may explain user-visible output, missing output, errors, cost spikes, or incomplete work. Linked instance IDs often appear under keys such as `subagent_agent_instance_id`, `agent_instance_id`, `jobId`, `outputs`, or `result_payload`.

When a linked instance looks relevant:

```bash
prefactor --profile <profile> agent_instances agent_context <linked-agent-instance-id> --output /tmp/prefactor-linked-agent-context.json
```

Use the same span-listing fallback when `agent_context` is unavailable. Stop expanding the graph when additional linked runs no longer change the story.

If no delegation signals appear in spans, report linked instances as `none / not applicable` and continue analysis on the main instance.

## Span analysis checklist

For each item, report findings from specific span IDs or `not observed`:

- **User-visible outcome**: final assistant text, result previews, and tool outputs vs source data in spans — where did divergence start?
- **Feedback signals**: quality or downvote spans — treat as leads; confirm the mechanism in LLM, tool, or linked-instance spans.
- **Decision points**: tool selection, argument values, early termination, ignored tool results.
- **Tool and LLM failures**: errors, empty results, retries, unexpected finish reasons.
- **Token and payload anomalies**: large prompts, bloated context, repeated schemas, growing accumulated fields.
- **State**: instance status, span counts, failed/pending spans, unfinished work.

Multiple independent faults can coexist. Do not collapse them into a single "the cause."

## Five whys workflow

After span analysis, walk the chain explicitly:

1. **Symptom** — what the user saw, confirmed in spans where possible.
2. **Why did that happen?** — first layer; often a specific span, tool, or LLM event (usually the trigger).
3. **Why was that allowed?** — missing validation, bad upstream input, wrong tool choice, prompt gap.
4. **Why was that gap present?** — design choice, missing test, operational constraint, undocumented assumption.
5. **Why was it not caught earlier?** — monitoring, review process, ownership, false confidence.

Continue beyond five if the chain is still shallow. Stop when you reach a systemic condition a human would need to change — and say so plainly.

## Output format

Deliver a findings report, not an action plan. Use these exact sections, even when the user asks for a concise answer:

### Symptom

What the user reported and what spans confirm about user-visible impact.

### Timeline

Ordered key events with span IDs and one-line summaries.

### Trigger

The immediate technical event that produced the symptom. Ground in span evidence.

### Root cause analysis (five whys)

Numbered why chain. Mark each step **confirmed**, **inferred**, or **hypothesis**.

### Contributing factors

Separate issues that did not alone cause the symptom but increased likelihood or severity.

### Linked instances

Which linked runs were inspected and what they changed — or `none / not applicable`.

### What spans cannot answer

Explicit gaps: missing context, human/process factors, intent behind prompts or schemas. Note any conclusions that could not be verified because the workspace is not the agent's codebase.

### Codebase points of interest

Relevant source tied to the findings — not a fix list. For each point, link span evidence to local code:

- File paths and symbols (functions, classes, modules, config keys).
- Prompt templates, system instructions, or context-assembly code when LLM behavior is in question.
- Tool handlers, validators, and error paths when tool spans are involved.
- Span schema registration and instrumentation when payload shape or missing fields matter.

Use code citations when referencing source. Explain briefly why each location matters to the investigation.

Ground every technical claim in span IDs, instance IDs, summaries, token counts, payload sizes, or concrete payload/result values.
