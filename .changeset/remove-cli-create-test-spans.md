---
"@prefactor/cli": minor
---

Remove the `agent_spans create_test_spans` command. That path is not in the OpenAPI spec.

Bump is minor, not major: `@prefactor/cli` is 0.x (a major changeset would publish 1.0.0). Command removal is a 0.x contract break, same level as the bulk rewrite.
