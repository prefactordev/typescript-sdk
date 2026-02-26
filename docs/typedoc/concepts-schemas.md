# Schemas and Return Schemas

Prefactor agent schemas describe the expected shape of span payloads and span results for each span type. In SDK terms, these are provided through `httpConfig.agentSchema` and registered with the agent manager during initialization. The provider packages include default schemas for their own prefixed span types, which keeps setup simple while preserving a clear contract for ingestion.

Each default provider schema defines both `span_schemas` and `span_result_schemas`. This separation lets you validate request-side fields and result-side fields independently, which is useful when your workflows evolve at different speeds for inputs and outputs. Out of the box, the SDK defaults are permissive object schemas with `additionalProperties: true`, so they do not block incremental instrumentation.

When you need stronger constraints, you can provide your own schema object in `httpConfig.agentSchema`. A common pattern is to start with permissive schemas while integrating traces, then tighten validation around critical span types once field names and payload conventions stabilize. This preserves developer velocity early and improves data consistency as the implementation matures.
