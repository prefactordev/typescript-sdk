---
name: report-agent-risk-data
description: Use when an agent is already instrumented with Prefactor and you need to populate data_risk fields on its span types to enable compliance tracking and data governance.
---

# Report Agent Risk Data

Populate `data_risk` metadata on span types for an agent that is already instrumented with Prefactor.

Core principle: infer, don't guess. Read the code each span type wraps and reason about what data enters and leaves it — then record that as risk metadata.

## Trigger Phrases

Apply this skill when the user asks for any of these:

- "add risk data to my agent"
- "populate data_risk for span types"
- "instrument risk data for compliance"
- "what data does my agent handle?"
- "fill in risk metadata on spans"
- "configure data governance for my agent"

## Prerequisite

The agent must already be instrumented with Prefactor and emitting spans. If it is not, first apply `skills/instrument-existing-agent-with-prefactor-sdk/SKILL.md`.

Also ensure you have:

- `agent_id` of the target agent
- Access to the agent source code

## Workflow

1. Discover all span types the agent emits.
2. For each span type, read the code it wraps and fill in `action_profile`.
3. For each span type, read its input parameters and fill in `params_data_categories`.
4. For each span type, read its output values and fill in `result_data_categories`.
5. Deliver risk data via the appropriate mechanism for the agent's SDK.
6. Verify the schema version was registered with `data_risk` on each span type.

## 1) Discover Span Types

Search the agent source for strings that name span types:

```bash
# Find span type declarations
rg "spanType|schema_name|withSpan|startSpan" --type ts -l

# Find string literals that look like span type names (package:category pattern)
rg '"[a-z][a-z0-9_-]*:[a-z][a-z0-9_:_-]*"' --type ts
```

For custom SDK agents, collect the unique span type strings used in `withSpan` or `startSpan` calls across the codebase.

## 2) Populate `action_profile`

For each span type, read the code it wraps and answer these six questions. Use `allowed` when the span explicitly performs the action, `disallowed` when it explicitly cannot, and `unknown` when it is unclear.

| Field | Set to `allowed` when... | Default when no evidence |
|---|---|---|
| `create_data` | span creates files, db records, or artifacts | `unknown` |
| `read_data` | span reads files, db, memory, or config | `unknown` |
| `update_data` | span modifies existing records or files | `unknown` |
| `destroy_data` | span deletes data | `unknown` |
| `financial_transactions` | span calls payment, billing, or financial APIs | `disallowed` |
| `external_communication` | span makes HTTP calls, sends email, or calls external APIs | `unknown` |

`financial_transactions` is the only field that should default to `disallowed` — most spans have no payment involvement and that can be stated confidently.

## 3) Populate `params_data_categories`

`params_data_categories` describes data that flows **into** the span as inputs.

First, set `classification` — the overall sensitivity level of the input data:

- `public` — only public web content, no user or org data
- `internal` — org-internal system data, no user PII
- `confidential` — user messages, org documents, or business data
- `restricted` — credentials, secrets, or high-sensitivity regulated data
- `secret` — highest sensitivity (rare)
- `unknown` — unclear from code inspection

Then set each of the 17 category fields to `included`, `excluded`, or `unknown`:

- Use `included` when you can confirm that type of data is present in inputs.
- Use `excluded` when you can confirm it is absent.
- Use `unknown` when it is unclear — do not use `excluded` speculatively.

Category fields:

```
personal_identifiers          — names, IDs, usernames
contact_information           — email, phone, address
financial_information         — payment details, account numbers
health_and_medical            — medical records, prescriptions
criminal_justice              — criminal records, legal proceedings
authentication_and_secrets    — passwords, API keys, tokens, private keys
organisational_confidential   — internal business documents, source code
minors_data                   — data relating to children
location_and_tracking         — GPS, IP address, movement history
behavioural_and_inferred      — usage patterns, inferred preferences
gdpr_racial_or_ethnic_origin
gdpr_political_opinions
gdpr_religious_or_philosophical_beliefs
gdpr_trade_union_membership
gdpr_genetic_data
gdpr_biometric_for_identification
gdpr_sex_life_or_sexual_orientation
```

## 4) Populate `result_data_categories`

`result_data_categories` describes data that flows **out of** the span as outputs. Use the same structure as `params_data_categories`.

Outputs are often narrower than inputs. A span that reads confidential files may return only a byte count or status, making many result categories `excluded`. Read the return values and result payload of the span before setting these fields.

## 5) Deliver Risk Data

### Other SDK agents

Create a new `agent_schema_version` via CLI with `span_type_schemas` containing `data_risk` on each entry:

```bash
prefactor agent_schema_versions create \
  --agent_id <agent-id> \
  --external_identifier <version-identifier> \
  --span_type_schemas '<json-array>'
```

Each element of the array should follow this shape:

```json
{
  "name": "<span-type-name>",
  "params_schema": { "type": "object", "properties": {} },
  "data_risk": {
    "action_profile": {
      "create_data": "unknown",
      "read_data": "unknown",
      "update_data": "unknown",
      "destroy_data": "unknown",
      "financial_transactions": "disallowed",
      "external_communication": "unknown"
    },
    "params_data_categories": {
      "classification": "unknown",
      "personal_identifiers": "unknown",
      "contact_information": "unknown",
      "financial_information": "unknown",
      "health_and_medical": "unknown",
      "criminal_justice": "unknown",
      "authentication_and_secrets": "unknown",
      "organisational_confidential": "unknown",
      "minors_data": "unknown",
      "location_and_tracking": "unknown",
      "behavioural_and_inferred": "unknown",
      "gdpr_racial_or_ethnic_origin": "unknown",
      "gdpr_political_opinions": "unknown",
      "gdpr_religious_or_philosophical_beliefs": "unknown",
      "gdpr_trade_union_membership": "unknown",
      "gdpr_genetic_data": "unknown",
      "gdpr_biometric_for_identification": "unknown",
      "gdpr_sex_life_or_sexual_orientation": "unknown"
    },
    "result_data_categories": { }
  }
}
```

## Common Starting Profiles

Use these as a starting point and adjust based on what you find in the code.

| Span type pattern | `action_profile` highlights | `classification` | Notable categories |
|---|---|---|---|
| `*:tool:read` | `read_data: allowed`, others `disallowed` | `confidential` | `authentication_and_secrets: included`, `organisational_confidential: included` |
| `*:tool:write` | `create_data: allowed`, others `disallowed` | `confidential` | `organisational_confidential: included` |
| `*:tool:edit` | `update_data: allowed`, others `disallowed` | `confidential` | `authentication_and_secrets: included`, `organisational_confidential: included` |
| `*:tool:exec` | `read_data: allowed`, `external_communication: disallowed` | `restricted` | `authentication_and_secrets: included`, `organisational_confidential: included` |
| `*:tool:web_search` / `*:tool:web_fetch` / `*:tool:browser` | `external_communication: allowed`, others `disallowed` | `public` | all categories `excluded` |
| `*:user_message` / `*:user_interaction` | all `unknown` except `financial_transactions: disallowed` | `confidential` | all `unknown` |
| `*:agent_run` / `*:session` | all `unknown` except `financial_transactions: disallowed` | `internal` | all `unknown` |
| `*:agent_thinking` / `*:assistant_response` | `create_data: allowed`, others `unknown` | `confidential` | all `unknown` |
| `*:tool` (generic fallback) | all `unknown` | `unknown` | all `unknown` |

## 6) Verify

After delivering risk data, retrieve the schema version and confirm `data_risk` is present:

```bash
# List schema versions for the agent
prefactor agent_schema_versions list --agent_id <agent-id>

# Retrieve and inspect a specific version
prefactor agent_schema_versions retrieve <schema-version-id>
```

Confirm the response includes `data_risk` on each span type schema entry.

## References

- For a per-span-type checklist covering all fields, read `references/risk-data-checklist.md`.

## Common Mistakes

- Setting all 17 category fields to `unknown` without reading the code — this defeats the purpose of the exercise.
- Using `financial_transactions: allowed` on spans that only incidentally display financial data without transacting.
- Setting `classification: public` on spans where user-controlled text can flow through.
- Leaving `result_data_categories` identical to `params_data_categories` without checking whether outputs are actually narrower.
- Overriding OpenClaw defaults and accidentally removing `financial_transactions: disallowed` from non-financial spans.
- Treating the populated risk data as final — it is a starting point for human review, not a compliance certification.
