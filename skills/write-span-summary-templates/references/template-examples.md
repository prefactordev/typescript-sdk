# Template Examples

Copy-paste Liquid templates for common span types. Each row notes which fields come from the **start** payload (`startSpan` inputs) and which from the **finish** result (`endSpan` outputs). Adapt field names to what your instrumentation actually sends.

## Simple field interpolation

```liquid
{{ model }}
```

- `model` — start. Renders the model name only. Good as a minimal fallback.

## LLM call

```liquid
Called {{ model }} with {{ message_count }} messages; finished with {{ finish_reason }}.
```

- `model`, `message_count` — start.
- `finish_reason` — finish.

Conditional variant that stays readable while the span is still running:

```liquid
LLM {{ model }}{% if total_tokens %}: {{ total_tokens }} tokens{% endif %}{% if finish_reason %} -> {{ finish_reason }}{% endif %}
```

## AI SDK LLM (`ai-sdk:llm`)

```liquid
LLM {{ inputs["ai.model.id"] }}{% if inputs["ai.model.provider"] %} ({{ inputs["ai.model.provider"] }}){% endif %}{% if outputs["ai.response.text"] %} -> {{ outputs["ai.response.text"] | truncate: 60 }}{% endif %}
```

- `inputs["ai.model.id"]`, `inputs["ai.model.provider"]` — start (middleware).
- `outputs["ai.response.text"]` — finish.

## AI SDK agent (`ai-sdk:agent`)

Middleware does not emit this span type today. Use a static label unless you emit it yourself:

```liquid
Agent run
```

## LangChain LLM (`langchain:llm`)

```liquid
LLM {{ inputs["langchain.model.name"] }}{% if outputs.content %} -> {{ outputs.content | truncate: 60 }}{% endif %}
```

- `inputs["langchain.model.name"]` — start.
- `outputs.content` — finish.

## LangChain agent (`langchain:agent`)

Middleware does not emit this span type today. Use a static label unless you emit it yourself:

```liquid
Agent run
```

## Tool / function call

```liquid
Looked up order {{ order_id }}; status {{ status }}.
```

- `order_id` — start.
- `status` — finish.

Generic tool template with error flagging:

```liquid
Tool {{ tool_name }}{% if status %} -> {{ status }}{% endif %}{% if is_error %} (error){% endif %}
```

- `tool_name` — start.
- `status`, `is_error` — finish.

LangChain / AI SDK tool span (from `toolSchemas`, span type `langchain:tool:calculator`):

```liquid
Tool {{ inputs.toolName }}{% if inputs.input.expression %}: {{ inputs.input.expression }}{% endif %}{% if outputs.output %} -> {{ outputs.output | truncate: 60 }}{% endif %}
```

- `inputs.toolName`, `inputs.input.expression` — start.
- `outputs.output` — finish.

## Custom span (`withSpan`)

Start field under `inputs` envelope:

```liquid
Example root: {{ inputs.example }}
```

String finish (wrapped as `result`):

```liquid
Normalized {{ inputs.rawLength }} chars{% if result %} -> {{ result | truncate: 60 }}{% endif %}
```

Object finish (fields at top level):

```liquid
Summary {{ wordCount }} words{% if inputs.normalizedLength %}, {{ inputs.normalizedLength }} chars{% endif %}{% if preview %}: {{ preview | truncate: 60 }}{% endif %}
```

- `inputs.example`, `inputs.rawLength`, `inputs.normalizedLength` — start (`withSpan` `inputs` option).
- `result` — finish when callback returns a string/primitive.
- `preview`, `wordCount` — finish when callback returns an object.

## User message / turn

```liquid
User ({{ role }}): {{ content }}
```

- `role`, `content` — start.

Turn with optional language and cancellation:

```liquid
{% if transcript %}User: {{ transcript }}{% else %}User turn{% endif %}{% if language %} ({{ language }}){% endif %}{% if status == "cancelled" %} -> cancelled{% endif %}
```

- `transcript`, `language`, `status` — finish.

## Assistant message

```liquid
{{ content }}
```

- `content` — start. The visible assistant reply.

## Session (nested objects + multiple optionals)

```liquid
Session {{ status }}{% if conversation.userMessages %}: {{ conversation.userMessages }} user, {{ conversation.assistantMessages }} assistant{% endif %}{% if metadata.closeReason %} ({{ metadata.closeReason }}){% endif %}
```

- `status`, `conversation.*`, `metadata.closeReason` — finish.
- Note the nested dot paths: reach into `conversation` and `metadata` rather than printing the whole object.

## Component metrics (STT / TTS)

```liquid
STT {{ model_name }}{% if metrics.audio_duration_ms %}: {{ metrics.audio_duration_ms }} ms audio{% endif %}{% if status %} -> {{ status }}{% endif %}
```

```liquid
TTS {{ model_name }}{% if metrics.characters_count %}: {{ metrics.characters_count }} chars{% endif %}{% if status %} -> {{ status }}{% endif %}
```

- `model_name` — start.
- `metrics.*`, `status` — finish.

## Error

```liquid
{{ provider }} error{% if error.error_type %} {{ error.error_type }}{% endif %}{% if error.message %}: {{ error.message }}{% endif %}
```

- `error.error_type`, `error.message` — finish.

## Source references

- LiveKit production templates: `packages/livekit/src/schema.ts` (`LIVEKIT_*_TEMPLATE` constants).
- LiveKit template tests: `packages/livekit/tests/schema.test.ts`.
- Core schema type with the `template` field: `packages/core/src/tracing/span-schema.ts`.
