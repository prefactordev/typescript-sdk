---
name: write-span-summary-templates
description: Use when writing or fixing span summary templates (display templates) on Prefactor span type schemas, when spans show raw JSON or blank summaries in the Prefactor UI, or when you want one-line Liquid summaries of agent, llm, tool, and custom spans.
---

# Write Span Summary Templates

Write Liquid display templates on span type schemas so each span shows a short, readable summary in the Prefactor UI instead of raw JSON.

Core principle: a template summarizes what happened in one line, built from the high-signal fields the span already sends.

## Trigger Phrases

Apply this skill when the user asks for any of these:

- "write span summary templates"
- "add display templates to my schemas"
- "my spans show raw JSON / blank summaries in Prefactor"
- "how do Prefactor templates work"
- "Liquid template for span types"
- "make my traces readable"

## Prerequisite

Your agent must already register an `agent_schema_version` with `span_type_schemas`. If it does not yet:

- Instrument it first with `skills/instrument-existing-agent-with-prefactor-sdk/SKILL.md`.
- Building a custom adapter? See `skills/create-provider-package-with-core/SKILL.md`.

You add templates to the schemas you register; the Prefactor backend renders them. The SDK never renders templates locally.

## Quick Start

1. List the span types your agent emits (e.g. `myapp:llm`, `myapp:tool:search`).
2. For each, pick the few fields that explain it at a glance (model, tool name, status, counts).
3. Note which fields come from the **start** payload and which from the **finish** result.
4. Write a short Liquid `template` string per span type.
5. Set `template` on each entry in `span_type_schemas`.
6. Make sure your instrumentation actually sends every field the template references.
7. Verify summaries in the Prefactor UI (the list API returns them when `include_summaries: true`).

## What Templates Do

A template renders to the `summary` field shown in Prefactor trace lists. Good summaries:

- Are short and field-driven: the action, the subject, optionally the outcome.
- Distinguish similar spans so a list is scannable.
- Never dump full prompts or full outputs.

## Where the Template Goes

Set `template` on each span type schema in the agent schema version you register:

```ts
import type { AgentSchemaVersion } from '@prefactor/core';

const agentSchema: AgentSchemaVersion = {
  external_identifier: 'myapp-schema-v1',
  span_type_schemas: [
    {
      name: 'myapp:llm',
      template: 'LLM {{ model }}{% if total_tokens %}: {{ total_tokens }} tokens{% endif %}{% if finish_reason %} -> {{ finish_reason }}{% endif %}',
      params_schema: {
        type: 'object',
        properties: { model: { type: 'string' } },
      },
      result_schema: {
        type: 'object',
        properties: {
          total_tokens: { type: 'integer' },
          finish_reason: { type: 'string' },
        },
      },
    },
  ],
};
```

The LiveKit package is the reference implementation in this repo: see `packages/livekit/src/schema.ts` for production templates and `packages/livekit/tests/schema.test.ts` for how they are tested.

### If your schema uses the legacy `span_schemas` maps

Some agents (and the `@prefactor/ai` and `@prefactor/langchain` defaults) register the older shape: a `span_schemas` map and a `span_result_schemas` map keyed by span type, with no place for a template. Templates only live on `span_type_schemas` entries.

Migrate each span type into a `span_type_schemas` array: carry the per-type `span_schemas` entry into `params_schema`, the `span_result_schemas` entry into `result_schema`, and add the `template`. When `span_type_schemas` is present the backend uses it and ignores the legacy maps, so drop the maps once everything is migrated rather than maintaining two copies.

```ts
const agentSchema = {
  external_identifier: 'myapp-schema-v1',
  span_type_schemas: [
    {
      name: 'ai-sdk:llm',
      template: 'LLM {{ inputs["ai.model.id"] }}',
      params_schema: { type: 'object', additionalProperties: true },
      result_schema: { type: 'object', additionalProperties: true },
    },
  ],
};
```

The array survives provider normalization (`@prefactor/ai` and `@prefactor/langchain` pass it through), so the templates reach the backend.

### Tools declared via `toolSchemas`

Some agents register tools under `toolSchemas` instead of listing each tool in `span_type_schemas`. The SDK still resolves runtime span types from `toolSchemas`, but **templates only apply to entries in `span_type_schemas`**.

Each `toolSchemas` entry gets a generated span type name:

`<provider>:tool:<spanTypeSuffix>`

- **provider** is the adapter prefix (`langchain`, `ai-sdk`).
- **spanTypeSuffix** comes from the entry's `spanType` field after normalization (e.g. `spanType: 'calculator'` with `@prefactor/langchain` → `langchain:tool:calculator`).

When `span_type_schemas` is present the backend uses it and ignores legacy maps. Tool schemas that `toolSchemas` would have injected into those maps are ignored too unless you also list each tool span type in `span_type_schemas`. Keep `toolSchemas` for SDK runtime span-type resolution; add a matching `span_type_schemas` entry for every tool you want summarized.

```ts
const agentSchema = {
  external_identifier: 'langchain-tool-schema-example-v2',
  span_type_schemas: [
    {
      name: 'custom:example-root',
      template: 'Example root: {{ inputs.example }}',
      params_schema: { type: 'object', additionalProperties: true },
      result_schema: { type: 'object', additionalProperties: true },
    },
    {
      name: 'langchain:tool:calculator',
      template:
        'Tool {{ inputs.toolName }}{% if inputs.input.expression %}: {{ inputs.input.expression }}{% endif %}{% if outputs.output %} -> {{ outputs.output | truncate: 60 }}{% endif %}',
      params_schema: { type: 'object', additionalProperties: true },
      result_schema: { type: 'object', additionalProperties: true },
    },
  ],
  toolSchemas: {
    calculator: {
      spanType: 'calculator',
      inputSchema: {
        type: 'object',
        properties: { expression: { type: 'string' } },
        required: ['expression'],
      },
    },
  },
};
```

Common field paths for `@prefactor/langchain` and `@prefactor/ai` tool spans:

- `inputs.toolName` — tool name
- `inputs.input.<field>` — tool arguments (e.g. `inputs.input.expression`)
- `outputs.output` — tool result (often a string; use `truncate`)

When no per-tool schema exists, spans fall back to the generic type (`langchain:tool`, `ai-sdk:tool`). Template those separately if you want a catch-all summary.

### `@prefactor/ai` and `@prefactor/langchain` middleware spans

These adapters emit **LLM and tool** spans through middleware. Payloads use the transport envelope: start fields under `inputs`, finish fields under `outputs`. Prefer `outputs["dotted.key"]` bracket paths for finish fields with dots in the name.

**Agent span types (`ai-sdk:agent`, `langchain:agent`)** — present in default schemas but **not emitted** by current middleware. Agent runs are tracked via agent instance lifecycle, not an agent span. If your schema lists these types but your app never emits them, use a static template or omit one:

```liquid
Agent run
```

Only reference runtime fields when you actually emit spans with that `spanType`.

**`ai-sdk:llm`**

```liquid
LLM {{ inputs["ai.model.id"] }}{% if inputs["ai.model.provider"] %} ({{ inputs["ai.model.provider"] }}){% endif %}{% if outputs["ai.response.text"] %} -> {{ outputs["ai.response.text"] | truncate: 60 }}{% endif %}
```

- Start: `inputs["ai.model.id"]`, `inputs["ai.model.provider"]`
- Finish: `outputs["ai.response.text"]`, `outputs["ai.finishReason"]`

**`ai-sdk:tool`** (generic; per-tool types use `ai-sdk:tool:<suffix>` from `toolSchemas`)

```liquid
Tool {{ inputs.toolName }}{% if outputs.output %} -> {{ outputs.output | truncate: 60 }}{% endif %}
```

**`langchain:llm`**

```liquid
LLM {{ inputs["langchain.model.name"] }}{% if outputs.content %} -> {{ outputs.content | truncate: 60 }}{% endif %}
```

- Start: `inputs["langchain.model.name"]`
- Finish: `outputs.content`

**`langchain:tool`** (generic; per-tool types use `langchain:tool:<suffix>` from `toolSchemas`)

Same field paths as `ai-sdk:tool`: `inputs.toolName`, `inputs.input.<field>`, `outputs.output`.

### Custom spans (`withSpan`)

Manual spans created with `prefactor.withSpan` or `@prefactor/core`'s `withSpan` use a different payload shape from adapter middleware spans.

**Start fields** — whatever you pass as `inputs` in the `withSpan` call is sent under an `inputs` key in the span payload. Template start fields as `{{ inputs.<field> }}`, not `{{ <field> }}`:

```ts
await prefactor.withSpan(
  {
    name: 'custom:example-root',
    spanType: 'custom:example-root',
    inputs: { example: 'my-agent/run.ts' },
  },
  async () => { /* ... */ }
);
```

```liquid
Example root: {{ inputs.example }}
```

**Finish fields** — the callback return value becomes `result_payload`:

- If the callback returns a **plain object**, its keys merge at the **top level** of the template context (e.g. `{ preview, wordCount }` → `{{ preview }}`, `{{ wordCount }}`).
- If the callback returns a **string, number, or other non-object**, it is wrapped as `{{ result }}`.

```ts
// returns a string → result_payload: { result: "..." }
await prefactor.withSpan(
  { spanType: 'custom:normalize-response', inputs: { rawLength: 120 } },
  async () => 'normalized text'
);
// template: Normalized {{ inputs.rawLength }} chars{% if result %} -> {{ result | truncate: 60 }}{% endif %}

// returns an object → result_payload: { preview: "...", wordCount: 42 }
await prefactor.withSpan(
  { spanType: 'custom:build-summary', inputs: { normalizedLength: 120 } },
  async () => ({ preview: '...', wordCount: 42 })
);
// template: Summary {{ wordCount }} words{% if preview %}: {{ preview | truncate: 60 }}{% endif %}
```

Register each custom `spanType` in `span_type_schemas` the same way as any other span type.

## Which Fields You Can Reference

At render time the backend merges the start payload and finish result into one context. A single `template` can reference both, and on a name collision the **finish (result) value wins**.

Reference fields by the exact shape your provider actually sends, not by a guessed name. The shape is provider-specific:

- **Custom `withSpan` spans** — start fields under `inputs` (`{{ inputs.example }}`); finish object fields at the top level (`{{ preview }}`); string/primitive finishes as `{{ result }}`.
- **`@prefactor/ai` / `@prefactor/langchain` middleware** — LLM and tool spans use the `inputs` / `outputs` envelope (`{{ inputs["ai.model.id"] }}`, `{{ outputs["ai.response.text"] }}`, `{{ inputs.toolName }}`, `{{ outputs.output }}`). Agent span types (`ai-sdk:agent`, `langchain:agent`) are schema defaults only unless you emit them yourself.
- **LiveKit and other adapters** — same envelope pattern in many cases (`{{ outputs.name }}`, `{{ outputs.message.content }}`).

When in doubt, look at one real span in the Prefactor UI (or the JSON payload) and mirror the field paths you see. Because most summaries are read after a span finishes, it is normal to mix start fields (e.g. `model`) and finish fields (e.g. `finish_reason`) in one template.

### Field keys that contain dots

A dot in a template means "traverse into an object". If a provider sends a literal key that contains a dot (e.g. the AI SDK key `ai.model.id`), dot syntax would wrongly traverse it. Use bracket notation with a quoted string on its parent instead:

```liquid
{{ inputs["ai.model.id"] }}
```

A dotted key only works when it hangs off a parent variable. There is no clean syntax for a bare top-level identifier that contains dots, so do not write `{{ ai.response.text }}`. In practice these fields are sent inside an `inputs` / `outputs` envelope, so reference them off that parent (`{{ outputs["ai.response.text"] }}`). If a dotted field really is at the very top level with no parent, you cannot reference it from a template; surface it under an envelope key from instrumentation first.

## Liquid Syntax Cheat Sheet

Prefactor uses Liquid (via Solid). These are the constructs you need:

```liquid
{{ model }}
{{ conversation.userMessages }}
{% if transcript %}User: {{ transcript }}{% else %}User turn{% endif %}
{% if status == "cancelled" %} -> cancelled{% endif %}
{{ toolName | default: "(unknown)" }}
{{ output | truncate: 60 }}
```

Standard Liquid filters work. The useful ones for summaries are `default: "..."` (fallback for missing values), `truncate: N` and `truncatewords: N` (cap long text), and `size` (length of a string or list). Use `truncate` to include an output preview without dumping the whole field.

Rules:

- Use **nested dot paths** to reach into objects: `{{ metadata.closeReason }}`, not `{{ metadata }}`. A bare object or array at a `{{ var }}` leaf renders as empty.
- Wrap every optional field in `{% if %}` so the summary still reads well when it is absent.
- Missing or null fields render as an empty string (rendering is non-strict).

## Authoring Checklist

Before shipping schema or template changes:

- [ ] Every `{{ var }}` is a field your instrumentation sends when the summary is shown.
- [ ] Optional fields are wrapped in conditionals.
- [ ] Similar span types produce distinguishable summaries.
- [ ] Schema, template, and instrumentation are updated together.
- [ ] Every `toolSchemas` entry you want summarized has a matching `span_type_schemas` entry named `<provider>:tool:<spanTypeSuffix>`.
- [ ] Custom `withSpan` start fields use the `inputs.<field>` path, not bare top-level names.
- [ ] `ai-sdk:agent` / `langchain:agent` templates are static unless you actually emit those span types.

## Common Pitfalls

- `result_template` is not rendered by the backend today. Put both start and finish fields in the single `template`.
- Invalid Liquid fails silently: the span just gets no summary. Recheck syntax if a summary is missing.
- Active (unfinished) spans will not have finish fields yet, so the summary shows only what is available so far.
- Do not patch a missing field with literal template text. If the template needs a value, send that value from instrumentation.

## Additional Resources

- Copy-paste patterns by span type: [references/template-examples.md](references/template-examples.md)
- In-repo reference templates: `packages/livekit/src/schema.ts`
