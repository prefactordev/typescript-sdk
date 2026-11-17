import type { AgentSchemaVersion, JsonSchema, SpanTypeSchema } from '@prefactor/core';
import { DEFAULT_SPAN_TYPE_RISK } from './data-risk.js';
import { SUPPORTED_TOOL_DEFINITIONS } from './tool-definitions.js';
import { PACKAGE_VERSION } from './version.js';

const OBJECT = { type: 'object' } as const;

const TOKEN_USAGE_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Token counts reported by the provider',
  properties: {
    input: { type: 'number' },
    output: { type: 'number' },
    cache_read: { type: 'number' },
    cache_write: { type: 'number' },
    reasoning: { type: 'number' },
    total: { type: 'number' },
  },
};

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

const TOOL_PARAMS_PROPERTIES = {
  tool_name: { type: 'string', description: 'Name of the pi tool' },
  tool_call_id: { type: 'string', description: 'Tool call id assigned by the model' },
  parent_tool_call_id: {
    type: 'string',
    description: 'Tool call id of the tool that made this call, when another tool made it',
  },
} as const;

const TOOL_RESULT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    content: { type: 'array', description: 'Content returned to the model' },
    details: { description: 'Structured details returned by the tool' },
    is_error: { type: 'boolean' },
    duration_ms: { type: 'number' },
  },
};

function toolSchema(
  spanType: string,
  description: string,
  inputSchema: JsonSchema,
  template: string
): SpanTypeSchema {
  return {
    name: spanType,
    description,
    template,
    params_schema: {
      type: 'object',
      properties: { ...TOOL_PARAMS_PROPERTIES, input: inputSchema },
      required: ['tool_name', 'tool_call_id'],
    },
    result_schema: TOOL_RESULT_SCHEMA,
    data_risk: DEFAULT_SPAN_TYPE_RISK[spanType],
  };
}

/**
 * Builds the agent schema version registered for each pi session.
 */
export function buildAgentSchemaVersion(): AgentSchemaVersion {
  const toolSchemas = Object.entries(SUPPORTED_TOOL_DEFINITIONS).map(([name, definition]) =>
    toolSchema(
      `pi:tool:${name}`,
      definition.description,
      definition.inputSchema,
      definition.template
    )
  );

  return {
    external_identifier: `prefactor-pi-${PACKAGE_VERSION}`,
    span_type_schemas: [
      {
        name: 'pi:session',
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
        name: 'pi:agent_run',
        description: 'One pi agent run, from agent_start to agent_end',
        template:
          '{% if prompt %}{% if prompt.size > 80 %}{{ prompt | slice: 0, 80 }}...{% else %}{{ prompt }}{% endif %}{% else %}(continued run){% endif %}{% if stop_reason %} -> {{ stop_reason }}{% endif %}',
        params_schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'User prompt that started the run' },
            images: { type: 'array', description: 'Images attached to the prompt' },
          },
        },
        result_schema: {
          type: 'object',
          properties: {
            response: { type: 'string', description: 'Text of the final assistant message' },
            stop_reason: { type: 'string' },
            error_message: { type: 'string' },
          },
        },
        data_risk: DEFAULT_SPAN_TYPE_RISK['pi:agent_run'],
      },
      {
        name: 'pi:llm',
        description: 'One LLM response',
        template:
          '{{ provider }}/{{ model }}{% if stop_reason %} -> {{ stop_reason }}{% endif %}{% if usage.total %} ({{ usage.total }} tokens){% endif %}',
        params_schema: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            model: { type: 'string' },
            api: { type: 'string' },
            messages: {
              type: 'array',
              description: 'Messages added to the context since the previous LLM call',
            },
          },
          required: ['provider', 'model'],
        },
        result_schema: {
          type: 'object',
          properties: {
            content: { type: 'array', description: 'Assistant message content' },
            stop_reason: { type: 'string' },
            error_message: { type: 'string' },
            response_model: { type: 'string' },
            response_id: { type: 'string' },
            usage: TOKEN_USAGE_SCHEMA,
            cost: COST_SCHEMA,
            duration_ms: { type: 'number' },
          },
        },
        data_risk: DEFAULT_SPAN_TYPE_RISK['pi:llm'],
      },
      toolSchema(
        'pi:tool',
        'Execution of a pi tool without its own span type',
        OBJECT,
        '{{ tool_name | default: "(unknown tool)" }}{% if is_error %} (error){% endif %}'
      ),
      ...toolSchemas,
    ],
  };
}
