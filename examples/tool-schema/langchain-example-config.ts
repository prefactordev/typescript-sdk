export const PREFACTOR_API_URL = 'https://app.prefactorai.com';
export const PREFACTOR_AGENT_ID = '01kkg1mkfgesddxmz81qzbyw69bg7fq0';
export const PREFACTOR_AGENT_IDENTIFIER = 'langchain-tool-schema-example-v1';
export const PREFACTOR_AGENT_SCHEMA_IDENTIFIER = 'langchain-tool-schema-example-schema-v1';

export const LANGCHAIN_TOOL_SCHEMA_EXAMPLE_AGENT_SCHEMA = {
  external_identifier: PREFACTOR_AGENT_SCHEMA_IDENTIFIER,
  span_schemas: {},
  span_result_schemas: {},
  toolSchemas: {
    get_customer_profile: {
      spanType: 'get-customer-profile',
      inputSchema: {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
        },
        required: ['customerId'],
      },
    },
    send_email: {
      spanType: 'send-email',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', format: 'email' },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
} as const satisfies Record<string, unknown>;
