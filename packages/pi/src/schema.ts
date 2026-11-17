import type { AgentSchemaVersion, JsonSchema, SpanTypeSchema } from '@prefactor/core';
import { DEFAULT_SPAN_TYPE_RISK, UNKNOWN_TOOL_RISK } from './data-risk.js';
import { SUPPORTED_TOOL_DEFINITIONS } from './tool-definitions.js';
import { PACKAGE_VERSION } from './version.js';

/** Version stamped as `_version` on every `$agent:*` payload and result, as Prefactor does. */
export const AGENT_SPAN_VERSION = 1;

/** Span type prefix for tool executions. */
export const TOOL_SPAN_PREFIX = '$agent:tool:';

/**
 * Span type for tools added after the session started, which have no span type of their own.
 * pi tool names cannot contain `:`, so this name never collides with a tool's own span type.
 */
export const FALLBACK_TOOL_SPAN_TYPE = `${TOOL_SPAN_PREFIX}pi:other`;

/** The name and description of a tool pi has when the session starts. */
export interface SessionTool {
  name: string;
  description?: string;
}

function versioned(
  properties: Record<string, JsonSchema>,
  required: string[] = Object.keys(properties)
): JsonSchema {
  return {
    type: 'object',
    properties: { _version: { const: AGENT_SPAN_VERSION }, ...properties },
    required: ['_version', ...required],
  };
}

const EMPTY_RESULT = versioned({});
const TEXT_PARAMS = versioned({ text: { type: 'string' } });

const USAGE_SCHEMA = versioned(
  {
    input_tokens: { type: 'integer', minimum: 0 },
    output_tokens: { type: 'integer', minimum: 0 },
    cache_read_input_tokens: { type: 'integer', minimum: 0 },
    cache_creation_input_tokens: { type: 'integer', minimum: 0 },
    reasoning_tokens: { type: 'integer', minimum: 0 },
    total_tokens: { type: 'integer', minimum: 0 },
  },
  []
);

const COST_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Cost reported by pi, in US dollars',
  properties: {
    input: { type: 'number' },
    output: { type: 'number' },
    cache_read: { type: 'number' },
    cache_write: { type: 'number' },
    total: { type: 'number' },
  },
};

function toolSchema(tool: SessionTool): SpanTypeSchema {
  const spanType = `${TOOL_SPAN_PREFIX}${tool.name}`;
  const definition = Object.hasOwn(SUPPORTED_TOOL_DEFINITIONS, tool.name)
    ? SUPPORTED_TOOL_DEFINITIONS[tool.name]
    : undefined;
  return {
    name: spanType,
    title: tool.name,
    description: definition?.description ?? tool.description ?? `The ${tool.name} tool`,
    template: definition?.template ?? `${tool.name}{% if error %} (error){% endif %}`,
    params_schema: versioned({
      tool_use_id: { type: 'string', description: 'Tool call id assigned by the model' },
      params: definition?.inputSchema ?? { type: 'object' },
    }),
    result_schema: versioned(
      {
        result: {
          type: 'object',
          properties: {
            content: { type: 'array', description: 'Content returned to the model' },
            details: { description: 'Structured details returned by the tool' },
          },
        },
        error: { type: 'string' },
      },
      []
    ),
    data_risk: DEFAULT_SPAN_TYPE_RISK[spanType] ?? UNKNOWN_TOOL_RISK,
  };
}

/**
 * Builds the agent schema version registered for each pi session. pi's own work is recorded with
 * the canonical `$agent:*` span types, so Prefactor shows the session as a conversation, inside
 * a `pi:session` root span. Each tool pi has at session start gets its own span type.
 */
export function buildAgentSchemaVersion(tools: SessionTool[]): AgentSchemaVersion {
  const toolSchemas = tools
    .filter((tool, index) => tools.findIndex((other) => other.name === tool.name) === index)
    .map(toolSchema);

  return {
    external_identifier: `prefactor-pi-${PACKAGE_VERSION}`,
    span_type_schemas: [
      {
        name: 'pi:session',
        title: 'pi session',
        description: 'One pi session, from session start to shutdown',
        template: 'pi session in {{ cwd | default: "(unknown directory)" }}',
        params_schema: {
          type: 'object',
          properties: {
            session_id: { type: 'string' },
            cwd: { type: 'string', description: 'Working directory of the session' },
            mode: { type: 'string', description: 'pi run mode: tui, rpc, json or print' },
            reason: { type: 'string', description: 'Why the session started' },
            provider: { type: 'string' },
            model: { type: 'string' },
          },
          required: ['session_id', 'cwd'],
        },
        result_schema: {
          type: 'object',
          properties: { reason: { type: 'string', description: 'Why the session shut down' } },
        },
        data_risk: DEFAULT_SPAN_TYPE_RISK['pi:session'],
      },
      {
        name: '$agent:system_message',
        title: 'System message',
        description: 'The system prompt, recorded when a run starts with a changed prompt',
        template: 'System message: {{ text }}',
        params_schema: TEXT_PARAMS,
        result_schema: EMPTY_RESULT,
        data_risk: DEFAULT_SPAN_TYPE_RISK['$agent:system_message'],
      },
      {
        name: '$agent:user_turn',
        title: 'User turn',
        description: 'One user turn',
        template: 'User turn {{ turn }}',
        params_schema: versioned({
          turn: { type: 'integer', description: 'Number of the user turn in this session' },
        }),
        result_schema: EMPTY_RESULT,
        data_risk: DEFAULT_SPAN_TYPE_RISK['$agent:user_turn'],
      },
      {
        name: '$agent:user_message',
        title: 'User message',
        description: 'A user message: a prompt, steering message or follow-up message',
        template: 'User message: {{ text }}',
        params_schema: TEXT_PARAMS,
        result_schema: EMPTY_RESULT,
        data_risk: DEFAULT_SPAN_TYPE_RISK['$agent:user_message'],
      },
      {
        name: '$agent:assistant_turn',
        title: 'Assistant turn',
        description: 'The assistant responses and tool calls that follow a user turn',
        template: 'Assistant turn{% if stop_reason %} -> {{ stop_reason }}{% endif %}',
        params_schema: versioned({}),
        result_schema: versioned({ stop_reason: { type: 'string' }, usage: USAGE_SCHEMA }, []),
        data_risk: DEFAULT_SPAN_TYPE_RISK['$agent:assistant_turn'],
      },
      {
        name: '$agent:llm_call',
        title: 'LLM call',
        description: 'One LLM response',
        template:
          '{{ request.provider_name }}/{{ request.model }}{% if response.stop_reason %} -> {{ response.stop_reason }}{% endif %}{% if response.usage.total_tokens %} ({{ response.usage.total_tokens }} tokens){% endif %}',
        params_schema: versioned({
          request: versioned(
            {
              model: { type: 'string' },
              provider_name: { type: 'string' },
              api: { type: 'string', description: 'pi API used to call the provider' },
            },
            ['model', 'provider_name']
          ),
        }),
        result_schema: versioned(
          {
            response: versioned(
              {
                id: { type: 'string' },
                model: { type: 'string', description: 'Model that answered' },
                provider_name: { type: 'string' },
                stop_reason: { type: 'string' },
                usage: USAGE_SCHEMA,
                cost: COST_SCHEMA,
                timestamp_started: { type: 'string', format: 'date-time' },
                timestamp_completed: { type: 'string', format: 'date-time' },
              },
              ['model', 'provider_name']
            ),
            error: { type: 'string' },
          },
          []
        ),
        data_risk: DEFAULT_SPAN_TYPE_RISK['$agent:llm_call'],
      },
      {
        name: '$agent:assistant_message',
        title: 'Assistant message',
        description: 'Assistant text produced by the model',
        template: 'Assistant message: {{ text }}',
        params_schema: TEXT_PARAMS,
        result_schema: EMPTY_RESULT,
        data_risk: DEFAULT_SPAN_TYPE_RISK['$agent:assistant_message'],
      },
      {
        name: '$agent:assistant_thinking',
        title: 'Assistant thinking',
        description: 'Model reasoning',
        template: 'Thinking: {{ text }}',
        params_schema: versioned({
          text: { type: 'string' },
          type: { type: 'string', enum: ['opaque', 'transparent'] },
        }),
        result_schema: EMPTY_RESULT,
        data_risk: DEFAULT_SPAN_TYPE_RISK['$agent:assistant_thinking'],
      },
      ...toolSchemas,
      {
        ...toolSchema({ name: 'pi:other' }),
        title: 'Other tool',
        description: 'Execution of a pi tool added after the session started',
        template: '{{ tool_name | default: "(unknown tool)" }}{% if error %} (error){% endif %}',
        params_schema: versioned({
          tool_use_id: { type: 'string', description: 'Tool call id assigned by the model' },
          tool_name: { type: 'string', description: 'Name of the pi tool' },
          params: { type: 'object' },
        }),
      },
    ],
  };
}
