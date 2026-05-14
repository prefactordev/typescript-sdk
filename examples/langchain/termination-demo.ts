/** LangChain math agent with Prefactor tracing. `bun run examples/langchain/termination-demo.ts` */
import { createAgent, tool } from 'langchain';
import { ChatAnthropic } from '@langchain/anthropic';
import { z } from 'zod';
import { init } from '@prefactor/core';
import { PrefactorLangChain } from '@prefactor/langchain';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function step(line: string): void {
  console.log(`step | ${line}`);
}

const TOOL_DELAY_MS = 1000;
const CHUNK_MS = 100;
const query =
  'Compute step by step with tools (no shortcuts): Start with 144. Square root. Multiply by 11. Subtract 7. Divide by 5. Add 2. Final number?';

function terminatedReason(signal: AbortSignal): string {
  return typeof signal.reason === 'string' ? signal.reason : 'terminated';
}

async function delayWithAbort(signal: AbortSignal, totalMs: number): Promise<boolean> {
  let elapsed = 0;
  while (elapsed < totalMs) {
    if (signal.aborted) return false;
    const part = Math.min(CHUNK_MS, totalMs - elapsed);
    await sleep(part);
    elapsed += part;
  }
  return !signal.aborted;
}

const logThoughtTool = tool(
  async ({ message }: { message: string }) => {
    step(`thought | ${message}`);
    return 'logged';
  },
  {
    name: 'log_thought',
    description: 'Write a short note about what you are doing or planning next (visible in the console).',
    schema: z.object({
      message: z.string().describe('One line of reasoning or intent'),
    }),
  }
);

function createAddTool(signal: AbortSignal) {
  return tool(
    async ({ a, b }: { a: number; b: number }) => {
      const ok = await delayWithAbort(signal, TOOL_DELAY_MS);
      if (!ok) {
        step(`add | aborted (${terminatedReason(signal)})`);
        return `add aborted — instance was ${terminatedReason(signal)}`;
      }
      const r = a + b;
      step(`add | ${a}+${b}=${r}`);
      return String(r);
    },
    {
      name: 'add',
      description: 'Sum of two numbers.',
      schema: z.object({
        a: z.number(),
        b: z.number(),
      }),
    }
  );
}

function createSubtractTool(signal: AbortSignal) {
  return tool(
    async ({ a, b }: { a: number; b: number }) => {
      const ok = await delayWithAbort(signal, TOOL_DELAY_MS);
      if (!ok) {
        step(`subtract | aborted (${terminatedReason(signal)})`);
        return `subtract aborted — instance was ${terminatedReason(signal)}`;
      }
      const r = a - b;
      step(`subtract | ${a}-${b}=${r}`);
      return String(r);
    },
    {
      name: 'subtract',
      description: 'a minus b.',
      schema: z.object({ a: z.number(), b: z.number() }),
    }
  );
}

function createMultiplyTool(signal: AbortSignal) {
  return tool(
    async ({ a, b }: { a: number; b: number }) => {
      const ok = await delayWithAbort(signal, TOOL_DELAY_MS);
      if (!ok) {
        step(`multiply | aborted (${terminatedReason(signal)})`);
        return `multiply aborted — instance was ${terminatedReason(signal)}`;
      }
      const r = a * b;
      step(`multiply | ${a}*${b}=${r}`);
      return String(r);
    },
    {
      name: 'multiply',
      description: 'Product of two numbers.',
      schema: z.object({ a: z.number(), b: z.number() }),
    }
  );
}

function createDivideTool(signal: AbortSignal) {
  return tool(
    async ({ a, b }: { a: number; b: number }) => {
      const ok = await delayWithAbort(signal, TOOL_DELAY_MS);
      if (!ok) {
        step(`divide | aborted (${terminatedReason(signal)})`);
        return `divide aborted — instance was ${terminatedReason(signal)}`;
      }
      if (b === 0) {
        step('divide | error division by zero');
        return 'Error: division by zero is undefined.';
      }
      const r = a / b;
      step(`divide | ${a}/${b}=${r}`);
      return String(r);
    },
    {
      name: 'divide',
      description: 'a divided by b (b non-zero).',
      schema: z.object({ a: z.number(), b: z.number() }),
    }
  );
}

function createSquareRootTool(signal: AbortSignal) {
  return tool(
    async ({ value }: { value: number }) => {
      const ok = await delayWithAbort(signal, TOOL_DELAY_MS);
      if (!ok) {
        step(`square_root | aborted (${terminatedReason(signal)})`);
        return `square_root aborted — instance was ${terminatedReason(signal)}`;
      }
      if (value < 0) {
        step('square_root | error negative input');
        return 'Error: square root of a negative number is not supported here.';
      }
      const r = Math.sqrt(value);
      step(`square_root | sqrt(${value})=${r}`);
      return String(r);
    },
    {
      name: 'square_root',
      description: 'Square root of a non-negative number.',
      schema: z.object({ value: z.number() }),
    }
  );
}

async function runAgentInstance(runNumber: number): Promise<void> {
  step(`run ${runNumber} | starting`);
  const prefactor = init({
    provider: new PrefactorLangChain(),
    httpConfig: {
      apiUrl: process.env.PREFACTOR_API_URL || 'http://localhost:8000',
      apiToken: process.env.PREFACTOR_API_TOKEN || 'dev-token',
      agentId: process.env.PREFACTOR_AGENT_ID,
      agentIdentifier: 'langchain-math-example',
      agentSchema: {
        external_identifier: 'langchain-math-example-schema',
        toolSchemas: {
          log_thought: {
            spanType: 'log_thought',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string' } },
              required: ['message'],
            },
          },
          add: {
            spanType: 'add',
            inputSchema: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
            },
          },
          subtract: {
            spanType: 'subtract',
            inputSchema: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
            },
          },
          multiply: {
            spanType: 'multiply',
            inputSchema: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
            },
          },
          divide: {
            spanType: 'divide',
            inputSchema: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
            },
          },
          square_root: {
            spanType: 'square_root',
            inputSchema: {
              type: 'object',
              properties: { value: { type: 'number' } },
              required: ['value'],
            },
          },
        },
      },
    },
  });

  try {
    const monitor = prefactor.getTerminationMonitor();
    const model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
      model: 'claude-haiku-4-5-20251001',
    });

    const signal = monitor.signal;
    const tools = [
      logThoughtTool,
      createAddTool(signal),
      createSubtractTool(signal),
      createMultiplyTool(signal),
      createDivideTool(signal),
      createSquareRootTool(signal),
    ];

    const agent = createAgent({
      model,
      tools,
      systemPrompt:
        'Math assistant. Use log_thought briefly before major moves. One arithmetic tool per step: add, subtract, multiply, divide, square_root. divide: b≠0. square_root: value≥0. End with the final number.',
      middleware: [prefactor.getMiddleware()],
    });

    await agent.invoke({ messages: [{ role: 'user', content: query }] });
  } catch (err) {
    if (err instanceof Error && err.name === 'PrefactorTerminatedError') {
      step(`run ${runNumber} | terminated | ${err.message}`);
    } else {
      throw err;
    }
  } finally {
    await prefactor.shutdown();
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required.');
  }

  let runNumber = 1;
  while (true) {
    await runAgentInstance(runNumber);
    runNumber += 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
