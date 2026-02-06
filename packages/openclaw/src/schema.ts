export const OPENCLAW_MESSAGE_TEXT_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'text' },
    text: { type: 'string' },
  },
  required: ['type', 'text'],
  additionalProperties: true,
} as const;

export const OPENCLAW_MESSAGE_TOOL_CALL_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'toolCall' },
    id: { type: 'string' },
    name: { type: 'string' },
    arguments: { type: 'object', additionalProperties: true },
  },
  required: ['type', 'id', 'name', 'arguments'],
  additionalProperties: true,
} as const;

const OPENCLAW_MESSAGE_GENERIC_CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    text: { type: 'string' },
    id: { type: 'string' },
    name: { type: 'string' },
    arguments: { type: 'object', additionalProperties: true },
  },
  required: ['type'],
  additionalProperties: true,
} as const;

const OPENCLAW_MESSAGE_CONTENT_SCHEMA = {
  oneOf: [
    OPENCLAW_MESSAGE_TEXT_SCHEMA,
    OPENCLAW_MESSAGE_TOOL_CALL_SCHEMA,
    OPENCLAW_MESSAGE_GENERIC_CONTENT_SCHEMA,
  ],
} as const;

const OPENCLAW_USAGE_SCHEMA = {
  type: 'object',
  properties: {
    cacheRead: { type: 'number' },
    cacheWrite: { type: 'number' },
    input: { type: 'number' },
    output: { type: 'number' },
    totalTokens: { type: 'number' },
    cost: {
      type: 'object',
      properties: {
        cacheRead: { type: 'number' },
        cacheWrite: { type: 'number' },
        input: { type: 'number' },
        output: { type: 'number' },
        total: { type: 'number' },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;

const OPENCLAW_MESSAGE_USER_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string', const: 'user' },
    content: {
      oneOf: [{ type: 'string' }, { type: 'array', items: OPENCLAW_MESSAGE_CONTENT_SCHEMA }],
    },
    timestamp: { type: 'number' },
  },
  required: ['role', 'content'],
  additionalProperties: true,
} as const;

const OPENCLAW_MESSAGE_ASSISTANT_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string', const: 'assistant' },
    content: {
      oneOf: [{ type: 'string' }, { type: 'array', items: OPENCLAW_MESSAGE_CONTENT_SCHEMA }],
    },
    timestamp: { type: 'number' },
    api: { type: 'string' },
    model: { type: 'string' },
    provider: { type: 'string' },
    stopReason: { type: 'string' },
    usage: OPENCLAW_USAGE_SCHEMA,
  },
  required: ['role', 'content'],
  additionalProperties: true,
} as const;

const OPENCLAW_MESSAGE_TOOL_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string', const: 'toolResult' },
    content: {
      oneOf: [{ type: 'string' }, { type: 'array', items: OPENCLAW_MESSAGE_CONTENT_SCHEMA }],
    },
    timestamp: { type: 'number' },
    toolCallId: { type: 'string' },
    toolName: { type: 'string' },
    isError: { type: 'boolean' },
    details: { type: 'object', additionalProperties: true },
  },
  required: ['role', 'content'],
  additionalProperties: true,
} as const;

const OPENCLAW_MESSAGE_BASE_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    content: {
      oneOf: [{ type: 'string' }, { type: 'array', items: OPENCLAW_MESSAGE_CONTENT_SCHEMA }],
    },
    timestamp: { type: 'number' },
    api: { type: 'string' },
    model: { type: 'string' },
    provider: { type: 'string' },
    stopReason: { type: 'string' },
    usage: OPENCLAW_USAGE_SCHEMA,
    toolCallId: { type: 'string' },
    toolName: { type: 'string' },
    isError: { type: 'boolean' },
    details: { type: 'object', additionalProperties: true },
  },
  required: ['role', 'content'],
  additionalProperties: true,
} as const;

const OPENCLAW_MESSAGE_SCHEMA = {
  oneOf: [
    OPENCLAW_MESSAGE_USER_SCHEMA,
    OPENCLAW_MESSAGE_ASSISTANT_SCHEMA,
    OPENCLAW_MESSAGE_TOOL_RESULT_SCHEMA,
    OPENCLAW_MESSAGE_BASE_SCHEMA,
  ],
} as const;

const OPENCLAW_MESSAGES_SCHEMA = {
  type: 'array',
  items: OPENCLAW_MESSAGE_SCHEMA,
} as const;

const OPENCLAW_INPUTS_SCHEMA = {
  type: 'object',
  properties: {
    messages: OPENCLAW_MESSAGES_SCHEMA,
    prompt: { type: 'string' },
  },
  additionalProperties: true,
} as const;

const OPENCLAW_CHAIN_IO_SCHEMA = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    direction: { type: 'string' },
    from: { type: 'string' },
    metadata: { type: 'object', additionalProperties: true },
  },
  additionalProperties: true,
} as const;

export const OPENCLAW_DEFAULT_SCHEMA = {
  external_identifier: '1.0.0',
  span_schemas: {
    agent: {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'agent' },
        inputs: OPENCLAW_INPUTS_SCHEMA,
        outputs: { type: 'object', additionalProperties: true },
      },
      required: ['type'],
      additionalProperties: true,
    },
    llm: {
      type: 'object',
      properties: { type: { type: 'string', const: 'llm' } },
    },
    tool: {
      type: 'object',
      properties: { type: { type: 'string', const: 'tool' } },
    },
    chain: {
      type: 'object',
      properties: {
        type: { type: 'string', const: 'chain' },
        inputs: OPENCLAW_CHAIN_IO_SCHEMA,
        outputs: OPENCLAW_CHAIN_IO_SCHEMA,
      },
      required: ['type'],
      additionalProperties: true,
    },
  },
} as const;
