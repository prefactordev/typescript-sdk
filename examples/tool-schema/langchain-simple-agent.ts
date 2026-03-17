import { init } from '@prefactor/core';
import {
  AIMessage,
  createAgent,
  HumanMessage,
  tool,
  ToolMessage,
} from 'langchain';
import { PrefactorLangChain } from '@prefactor/langchain';
import { z } from 'zod';
import {
  LANGCHAIN_TOOL_SCHEMA_EXAMPLE_AGENT_SCHEMA,
  PREFACTOR_AGENT_ID,
  PREFACTOR_AGENT_IDENTIFIER,
  PREFACTOR_AGENT_SCHEMA_IDENTIFIER,
  PREFACTOR_API_URL,
} from './langchain-example-config.js';

const customerProfileInputSchema = z.object({
  customerId: z.string().describe('Customer identifier to retrieve'),
});

const sendEmailInputSchema = z.object({
  to: z.email().describe('Recipient email address'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Email body text'),
});

const getCustomerProfileTool = tool(
  async ({ customerId }) => ({
    id: customerId,
    email: `${customerId}@example.com`,
    name: 'Taylor Example',
  }),
  {
    name: 'get_customer_profile',
    description: 'Fetch a synthetic customer profile for a given customer ID.',
    schema: customerProfileInputSchema,
  }
);

const sendEmailTool = tool(
  async ({ to, subject }) => ({
    receiptId: `receipt-${to}-${subject.length}`,
    accepted: true,
  }),
  {
    name: 'send_email',
    description: 'Pretend to send an email and return a delivery receipt.',
    schema: sendEmailInputSchema,
  }
);

const getCurrentDateTool = tool(
  async () => new Date().toISOString().slice(0, 10),
  {
    name: 'get_current_date',
    description: 'Return today in YYYY-MM-DD format.',
    schema: z.object({}),
  }
);

async function main() {
  const { ANTHROPIC_API_KEY, PREFACTOR_API_TOKEN } = process.env;

  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY must be set before running this example.');
  }

  if (!PREFACTOR_API_TOKEN) {
    throw new Error('PREFACTOR_API_TOKEN must be set before running this example.');
  }

  const prefactor = init({
    provider: new PrefactorLangChain(),
    httpConfig: {
      apiUrl: PREFACTOR_API_URL,
      apiToken: PREFACTOR_API_TOKEN,
      agentId: PREFACTOR_AGENT_ID,
      agentIdentifier: PREFACTOR_AGENT_IDENTIFIER,
      agentName: 'LangChain Tool Schema Example',
      agentDescription: 'LangChain example for automatic per-tool span schemas.',
      agentSchema: LANGCHAIN_TOOL_SCHEMA_EXAMPLE_AGENT_SCHEMA,
    },
  });

  const agent = createAgent({
    model: 'claude-3-haiku-20240307',
    tools: [getCustomerProfileTool, sendEmailTool, getCurrentDateTool],
    systemPrompt:
      'You are a helpful assistant. Use the available tools when they are needed.',
    middleware: [prefactor.getMiddleware()],
  });

  try {
    const input = {
      messages: [
        new HumanMessage(
          "Use get_customer_profile for customer cust_123, then use send_email to notify them that their profile review is complete. Also use get_current_date. After the tool calls, return a final plain-text summary that includes the customer email, whether the email send was accepted, and today's date."
        ),
      ],
    } as unknown as Parameters<typeof agent.invoke>[0];

    const result = await agent.invoke(input);

    console.log('Agent identifier:', PREFACTOR_AGENT_IDENTIFIER);
    console.log('Schema identifier:', PREFACTOR_AGENT_SCHEMA_IDENTIFIER);
    console.log('Response:');
    console.log(extractFinalResponseText(result.messages) ?? '(model returned no final text)');
    console.log();

    const toolCalls = extractToolCalls(result.messages);
    console.log('Tool calls:');
    for (const toolCall of toolCalls) {
      console.log(`- ${toolCall.toolName}: ${JSON.stringify(toolCall.input)}`);
    }
    console.log();

    const toolResults = extractToolResults(result.messages);
    console.log('Tool results:');
    for (const toolResult of toolResults) {
      console.log(`- ${toolResult.toolName}: ${JSON.stringify(toolResult.output)}`);
    }
  } finally {
    await prefactor.shutdown();
  }
}

function extractFinalResponseText(messages: unknown[]): string | undefined {
  for (const message of [...messages].reverse()) {
    if (!AIMessage.isInstance(message)) {
      continue;
    }

    const text = stringifyContent(message.content);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractToolCalls(messages: unknown[]): Array<{ toolName: string; input: unknown }> {
  const toolCalls: Array<{ toolName: string; input: unknown }> = [];

  for (const message of messages) {
    if (!AIMessage.isInstance(message)) {
      continue;
    }

    for (const toolCall of message.tool_calls ?? []) {
      toolCalls.push({
        toolName: toolCall.name,
        input: toolCall.args,
      });
    }
  }

  return toolCalls;
}

function extractToolResults(messages: unknown[]): Array<{ toolName: string; output: unknown }> {
  const toolResults: Array<{ toolName: string; output: unknown }> = [];

  for (const message of messages) {
    if (!ToolMessage.isInstance(message)) {
      continue;
    }

    toolResults.push({
      toolName: message.name ?? 'unknown',
      output: stringifyContent(message.content),
    });
  }

  return toolResults;
}

function stringifyContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return content === undefined ? undefined : JSON.stringify(content);
  }

  const textParts = content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return undefined;
      }

      const candidate = part as {
        text?: unknown;
        type?: unknown;
      };

      if (candidate.type === 'text' && typeof candidate.text === 'string') {
        return candidate.text;
      }

      return undefined;
    })
    .filter((part): part is string => part !== undefined);

  if (textParts.length > 0) {
    return textParts.join('');
  }

  return JSON.stringify(content);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
