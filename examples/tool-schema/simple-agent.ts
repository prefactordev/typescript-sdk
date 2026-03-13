import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool, wrapLanguageModel } from "ai";
import { init } from "@prefactor/core";
import { PrefactorAISDK } from "@prefactor/ai";
import { z } from "zod";
const PREFACTOR_AGENT_IDENTIFIER = "tool-schema-example-v4";

const customerProfileInputSchema = z.object({
  customerId: z.string().describe("Customer identifier to retrieve"),
});

const sendEmailInputSchema = z.object({
  to: z.email().describe("Recipient email address"),
  subject: z.string().describe("Email subject"),
  body: z.string().describe("Email body text"),
});

const getCustomerProfileTool = tool({
  description: "Fetch a synthetic customer profile for a given customer ID.",
  inputSchema: customerProfileInputSchema,
  execute: async ({ customerId }) => ({
    id: customerId,
    email: `${customerId}@example.com`,
    name: "Taylor Example",
  }),
});

const sendEmailTool = tool({
  description: "Pretend to send an email and return a delivery receipt.",
  inputSchema: sendEmailInputSchema,
  execute: async ({ to, subject }) => ({
    receiptId: `receipt-${to}-${subject.length}`,
    accepted: true,
  }),
});

const getCurrentDateTool = tool({
  description: "Return today in YYYY-MM-DD format.",
  inputSchema: z.object({}),
  execute: async () => new Date().toISOString().slice(0, 10),
});

async function main() {
  const { ANTHROPIC_API_KEY, PREFACTOR_API_TOKEN } = process.env;

  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY must be set before running this example.",
    );
  }

  if (!PREFACTOR_API_TOKEN) {
    throw new Error(
      "PREFACTOR_API_TOKEN must be set before running this example.",
    );
  }

  const prefactor = init({
    provider: new PrefactorAISDK(),
    httpConfig: {
      apiUrl: process.env.PREFACTOR_API_URL!,
      apiToken: PREFACTOR_API_TOKEN,
      agentId: process.env.PREFACTOR_AGENT_ID,
      agentIdentifier: PREFACTOR_AGENT_IDENTIFIER,
      agentName: "Tool Schema Example",
      agentDescription: "AI SDK example for automatic per-tool span schemas.",
      agentSchema: {
        external_identifier: "ai-sdk-tool-schema-example-v3",
        span_schemas: {},
        span_result_schemas: {},
        toolSchemas: {
          get_customer_profile: {
            spanType: "get-customer-profile",
            inputSchema: {
              type: "object",
              properties: {
                customerId: { type: "string" },
              },
              required: ["customerId"],
            },
          },
          send_email: {
            spanType: "send-email",
            inputSchema: {
              type: "object",
              properties: {
                to: { type: "string", format: "email" },
                subject: { type: "string" },
                body: { type: "string" },
              },
              required: ["to", "subject", "body"],
            },
          },
        },
      },
    },
  });

  const model = wrapLanguageModel({
    model: anthropic("claude-3-haiku-20240307"),
    middleware: prefactor.getMiddleware(),
  });

  try {
    const result = await generateText({
      model,
      prompt:
        "Use get_customer_profile for customer cust_123, then use send_email to notify them that their profile review is complete. Also use get_current_date. After the tool calls, return a final plain-text summary that includes the customer email, whether the email send was accepted, and today's date.",
      tools: {
        get_customer_profile: getCustomerProfileTool,
        send_email: sendEmailTool,
        get_current_date: getCurrentDateTool,
      },
      stopWhen: stepCountIs(6),
    });

    console.log("Agent identifier:", PREFACTOR_AGENT_IDENTIFIER);
    console.log("Schema identifier:", "ai-sdk-tool-schema-example-v3");
    console.log("Response:");
    console.log(result.text || "(model returned no final text)");
    console.log();
    console.log("Tool calls:");
    for (const toolCall of result.toolCalls) {
      console.log(`- ${toolCall.toolName}: ${JSON.stringify(toolCall.input)}`);
    }
    console.log();
    console.log("Tool results:");
    for (const toolResult of result.toolResults ?? []) {
      console.log(
        `- ${toolResult.toolName}: ${JSON.stringify(toolResult.output)}`,
      );
    }
  } finally {
    await prefactor.shutdown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
