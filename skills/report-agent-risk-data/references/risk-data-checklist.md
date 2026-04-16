# Risk Data Checklist

Use this checklist once per span type. Work through it sequentially — pre-analysis first, then `action_profile`, then data categories, then delivery.

## Pre-Analysis

- [ ] List all span type names emitted by the agent (grep for `spanType`, `schema_name`, `withSpan`, `startSpan`).
- [ ] For each span type, locate the code block it wraps.
- [ ] Read inputs (function arguments, payload fields) passed into the span.
- [ ] Read outputs (return values, result payload) produced by the span.

## `action_profile` (repeat for each span type)

Answer each question based on what the wrapped code actually does.

- [ ] Does this span **create** files, records, or artifacts? → `create_data: allowed` / `disallowed` / `unknown`
- [ ] Does this span **read** files, db, memory, or config? → `read_data: allowed` / `disallowed` / `unknown`
- [ ] Does this span **modify** existing data or files? → `update_data: allowed` / `disallowed` / `unknown`
- [ ] Does this span **delete** data? → `destroy_data: allowed` / `disallowed` / `unknown`
- [ ] Does this span call **payment, billing, or financial APIs**? → `financial_transactions: allowed` (rare) / `disallowed` (default for most spans)
- [ ] Does this span make **HTTP calls or contact external services**? → `external_communication: allowed` / `disallowed` / `unknown`

## `params_data_categories` (inputs)

- [ ] Set `classification`: `public` / `internal` / `confidential` / `restricted` / `secret` / `unknown`
- [ ] `personal_identifiers` (names, usernames, IDs): `included` / `excluded` / `unknown`
- [ ] `contact_information` (email, phone, address): `included` / `excluded` / `unknown`
- [ ] `financial_information` (payment details, account numbers): `included` / `excluded` / `unknown`
- [ ] `health_and_medical` (medical records): `included` / `excluded` / `unknown`
- [ ] `criminal_justice` (criminal records, legal proceedings): `included` / `excluded` / `unknown`
- [ ] `authentication_and_secrets` (passwords, API keys, tokens): `included` / `excluded` / `unknown`
- [ ] `organisational_confidential` (internal docs, source code): `included` / `excluded` / `unknown`
- [ ] `minors_data` (data relating to children): `included` / `excluded` / `unknown`
- [ ] `location_and_tracking` (GPS, IP address): `included` / `excluded` / `unknown`
- [ ] `behavioural_and_inferred` (usage patterns, inferred preferences): `included` / `excluded` / `unknown`
- [ ] `gdpr_racial_or_ethnic_origin`: `included` / `excluded` / `unknown`
- [ ] `gdpr_political_opinions`: `included` / `excluded` / `unknown`
- [ ] `gdpr_religious_or_philosophical_beliefs`: `included` / `excluded` / `unknown`
- [ ] `gdpr_trade_union_membership`: `included` / `excluded` / `unknown`
- [ ] `gdpr_genetic_data`: `included` / `excluded` / `unknown`
- [ ] `gdpr_biometric_for_identification`: `included` / `excluded` / `unknown`
- [ ] `gdpr_sex_life_or_sexual_orientation`: `included` / `excluded` / `unknown`

## `result_data_categories` (outputs)

Read the return values and result payload before completing this section — outputs are often narrower than inputs.

- [ ] Set `classification` for outputs (may differ from inputs).
- [ ] Complete all 17 category fields for outputs (same fields as params above).

## Delivery

- [ ] **OpenClaw**: pass completed profiles to `AgentConfig.spanTypeRiskConfigs` via `createRiskConfig()`.
- [ ] **Other SDK**: build `span_type_schemas` JSON array and run `prefactor agent_schema_versions create --span_type_schemas`.

## Verification

- [ ] Run `prefactor agent_schema_versions list --agent_id <agent-id>` and retrieve the latest version.
- [ ] Confirm `data_risk` is present on every span type schema entry in the response.
- [ ] Flag any span types where all fields are still `unknown` — these need a second pass or a comment explaining why.

## Fast Review Notes

- `financial_transactions: disallowed` is the correct default for the vast majority of spans.
- A `classification` of `public` is only appropriate when the span exclusively handles public web content with no user input.
- `excluded` means you are confident a data type is absent — do not use it speculatively.
- This output is a starting point for human review, not a compliance certification.
