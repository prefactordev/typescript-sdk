/**
 * Prefactor SDK -- Termination Demo
 *
 * This example demonstrates how the SDK detects p2 termination and allows
 * in-progress agent work to be gracefully aborted.
 *
 * How it works:
 * 1. An agent starts running with multiple tools (some long-running)
 * 2. After a configurable delay, a background task calls the p2 terminate API
 * 3. The SDK's TerminationMonitor polls `/api/v1/agent_instance/{id}` and
 *    detects when `status` changes to `terminated`
 * 4. The internal AbortController fires, and the AbortSignal is set
 * 5. The LangChain middleware's "throwIfTerminated" check fires
 *    between agent steps (LLM calls, tool calls)
 * 6. Long-running tools that check `signal.aborted` on each iteration also stop
 *
 * Usage:
 *   bun run examples/langchain/termination-demo.ts
 *
 *   # Custom auto-terminate delay (seconds; 0 = manual)
 *   PREFACTOR_AUTO_TERMINATE_DELAY=3 bun run examples/langchain/termination-demo.ts
 *
 *   # Manual mode — you call terminate from another terminal
 *   PREFACTOR_AUTO_TERMINATE_DELAY=0 bun run examples/langchain/termination-demo.ts
 *
 * Prerequisites:
 *   - p2 running (default http://localhost:8000)
 *   - ANTHROPIC_API_KEY set (for Claude model)
 */
import { createAgent, tool } from 'langchain';
import { ChatAnthropic } from '@langchain/anthropic';
import { z } from 'zod';
import { init } from '@prefactor/core';
import { PrefactorLangChain } from '@prefactor/langchain';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -- Tools ----------------------------------------------------------------

const calculatorTool = tool(
  async ({ expression }: { expression: string }) => {
    const cleaned = expression.replace(/[^0-9+\-*/.()% ]/g, '').trim();
    try {
      // biome-ignore lint/security/noUnsafeEval: safe after sanitization
      const result = eval(cleaned);
      return `Result: ${result}`;
    } catch {
      return `Error: could not evaluate "${expression}"`;
    }
  },
  {
    name: 'calculator',
    description: 'Evaluate a mathematical expression.',
    schema: z.object({
      expression: z.string().describe('The mathematical expression to evaluate'),
    }),
  }
);

const getCurrentTimeTool = tool(
  async () => {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  },
  {
    name: 'get_current_time',
    description: 'Get the current date and time.',
    schema: z.object({}),
  }
);

const getWeatherTool = tool(
  async ({ city }: { city: string }) => {
    const conditions = ['sunny', 'cloudy', 'rainy', 'windy'];
    const temps = [8, 12, 15, 18, 22, 25, 28, 32];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temp = temps[Math.floor(Math.random() * temps.length)];
    return JSON.stringify({ city, temperature_c: temp, condition });
  },
  {
    name: 'get_weather',
    description: 'Get current weather for a city (mock).',
    schema: z.object({
      city: z.string().describe('City name'),
    }),
  }
);

// -- Long-running tool that checks the abort signal each cycle ------------

function createCountdownTool(signal: AbortSignal) {
  return tool(
    async ({ seconds }: { seconds: number }) => {
      for (let i = seconds; i > 0; i--) {
        if (signal.aborted) {
          const reason = typeof signal.reason === 'string' ? signal.reason : 'terminated';
          return `Countdown aborted at ${i}s — instance was ${reason}`;
        }
        console.log(`  ⏳ Countdown: ${i}s remaining...`);
        await sleep(500);
      }
      return 'Countdown complete. Lift-off!';
    },
    {
      name: 'countdown',
      description: 'Count down from N seconds with 0.5s pauses. Checks for termination.',
      schema: z.object({
        seconds: z.number().describe('Number of seconds to count down from'),
      }),
    }
  );
}

function createPrimeCheckTool(signal: AbortSignal) {
  return tool(
    async ({ number, delay_ms }: { number: number; delay_ms?: number }) => {
      const delay = delay_ms ?? 200;
      const factors: number[] = [];
      const n = Math.abs(Math.floor(number));

      for (let i = 2; i <= Math.sqrt(n); i++) {
        if (signal.aborted) {
          const reason = typeof signal.reason === 'string' ? signal.reason : 'terminated';
          return `Prime check aborted at factor ${i} — instance was ${reason}`;
        }

        if (n % i === 0) {
          factors.push(i);
          if (factors.length >= 3) break;
        }

        if (i % 10_000 === 0) {
          await sleep(delay);
        }
      }

      if (factors.length === 0) {
        return `${n} is prime`;
      }

      return `${n} is composite. Factors found: ${factors.join(', ')}`;
    },
    {
      name: 'prime_check',
      description:
        'Check if a number is prime. Large numbers take time and check for termination between iterations.',
      schema: z.object({
        number: z.number().describe('Number to test for primality'),
        delay_ms: z.number().optional().describe('Delay in ms between chunked checks'),
      }),
    }
  );
}

// -- Termination helper ---------------------------------------------------

async function terminateInstance(
  apiUrl: string,
  apiToken: string,
  agentInstanceId: string,
  reason: string
): Promise<void> {
  const url = `${apiUrl}/api/v1/agent_instance/${agentInstanceId}/terminate`;
  console.log(`\n  📡 Calling terminate API: POST ${url}`);
  console.log(`     Reason: "${reason}"\n`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ reason }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Terminate API returned ${response.status}: ${JSON.stringify(body)}`);
  }

  console.log(`  ✅ Terminate API response: status=${body.status}`);
}

async function scheduleAutoTerminate(
  prefactor: ReturnType<typeof init>,
  apiUrl: string,
  apiToken: string,
  delaySeconds: number
): Promise<void> {
  console.log(`\n  ⏰ Auto-terminate scheduled in ${delaySeconds}s...`);

  // Wait for the agent instance to register (poll until ID is available)
  let instanceId: string | null = null;
  while (!instanceId) {
    instanceId = prefactor.getAgentInstanceId();
    if (!instanceId) {
      await sleep(500);
    }
  }

  console.log(`  📎 Agent instance ID: ${instanceId}`);

  await sleep(delaySeconds * 1000);

  await terminateInstance(apiUrl, apiToken, instanceId, 'automated demo termination');
}

// -- Main -----------------------------------------------------------------

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required.');
  }

  const apiUrl = process.env.PREFACTOR_API_URL || 'http://localhost:8000';
  const apiToken = process.env.PREFACTOR_API_TOKEN || 'dev-token';
  const autoDelay = parseInt(process.env.PREFACTOR_AUTO_TERMINATE_DELAY ?? '5', 10);

  console.log('='.repeat(72));
  console.log('Prefactor SDK — Termination Demo');
  console.log('='.repeat(72));
  console.log(`  API:       ${apiUrl}`);
  console.log(`  Auto-stop: ${autoDelay > 0 ? `${autoDelay}s` : 'manual (call terminate yourself)'}`);
  console.log();

  const prefactor = init({
    provider: new PrefactorLangChain(),
    httpConfig: {
      apiUrl,
      apiToken,
      agentId: process.env.PREFACTOR_AGENT_ID,
      agentIdentifier: 'termination-demo-v1',
      agentSchema: {
        external_identifier: 'termination-demo-schema-v1',
        span_schemas: {
          'custom:example-root': { type: 'object', additionalProperties: true },
        },
        span_result_schemas: {
          'custom:example-root': { type: 'object', additionalProperties: true },
        },
        toolSchemas: {
          calculator: {
            spanType: 'calculator',
            inputSchema: {
              type: 'object',
              properties: { expression: { type: 'string' } },
              required: ['expression'],
            },
          },
          countdown: {
            spanType: 'countdown',
            inputSchema: {
              type: 'object',
              properties: { seconds: { type: 'number' } },
              required: ['seconds'],
            },
          },
          prime_check: {
            spanType: 'prime_check',
            inputSchema: {
              type: 'object',
              properties: {
                number: { type: 'number' },
                delay_ms: { type: 'number' },
              },
              required: ['number'],
            },
          },
        },
      },
    },
  });

  const monitor = prefactor.getTerminationMonitor();
  monitor.onTerminated((reason) => {
    console.log(`\n  🛑 TerminationMonitor fired! Reason: "${reason ?? '(none)'}"`);
    console.log('  🛑 AbortSignal is now aborted.\n');
  });

  const signal = monitor.signal;

  const model = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
    model: 'claude-3-haiku-20240307',
  });

  const tools = [
    calculatorTool,
    getCurrentTimeTool,
    getWeatherTool,
    createCountdownTool(signal),
    createPrimeCheckTool(signal),
  ];

  const agent = createAgent({
    model,
    tools,
    systemPrompt:
      'You are a helpful assistant. When you start any task, first check the current time. ' +
      'When using countdown or prime_check, report back the full result exactly as the tool returns it.',
    middleware: [prefactor.getMiddleware()],
  });

  let terminated = false;

  try {
    if (autoDelay > 0) {
      scheduleAutoTerminate(prefactor, apiUrl, apiToken, autoDelay).catch((err) => {
        console.error('Auto-terminate failed:', err);
      });
    } else {
      console.log('  📋 Manual mode: The agent is now running.');
      console.log(
        '     In another terminal, use the p2 CLI or curl to terminate.'
      );
      console.log(
        '     Example: curl -XPOST -H "Authorization: Bearer dev-token" \\'
      );
      console.log(
        `       "${apiUrl}/api/v1/agent_instance/{id}/terminate" \\`
      );
      console.log('       -H "Content-Type: application/json" \\');
      console.log('       -d \'{"reason":"manual test"}\'');
      console.log();
    }

    await prefactor.withSpan(
      {
        name: 'termination-demo:root',
        spanType: 'custom:example-root',
        inputs: {
          example: 'termination-demo',
          autoTerminateDelay: autoDelay,
        },
      },
      async () => {
        const query =
          "First tell me the current time and weather in Tokyo. " +
          "Then do a countdown from 8. " +
          "Then check if 9876543221 is prime. " +
          "After that, tell me the weather in London.";

        console.log('  🤖 Agent query:');
        console.log(`     "${query}"`);
        console.log();

        const result = await agent.invoke({
          messages: [{ role: 'user', content: query }],
        });

        if (!monitor.terminated) {
          // Only show result if we weren't terminated
          console.log('\n  ✅ Agent completed without termination.\n');
          const lastMessage = result.messages[result.messages.length - 1];
          console.log('  Agent response:', lastMessage.content);
        }
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'PrefactorTerminatedError') {
      terminated = true;
      console.log('\n  🛑 Agent was terminated by p2 while running!');
      console.log(`     ${error.message}`);
      console.log();
    } else {
      console.error('\n  ❌ Unexpected error:', error);
    }
  } finally {
    if (autoDelay > 0 && !monitor.terminated && !terminated) {
      console.log(
        '  ⚠️  Agent completed before auto-terminate fired. Try a lower delay or a larger task.\n'
      );
    }

    console.log('  Flushing pending spans...');
    await prefactor.shutdown();
    console.log('  Shutdown complete.\n');
    console.log('='.repeat(72));

    if (terminated || monitor.terminated) {
      console.log('✅ Termination demo SUCCESS — instance was terminated mid-execution');
    } else if (autoDelay === 0) {
      console.log('⏳ Agent ran to completion (manual mode)');
    } else {
      console.log('⚠️  Agent completed before auto-terminate fired');
    }
    console.log('='.repeat(72));
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
