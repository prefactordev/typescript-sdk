/**
 * Prefactor SDK -- Termination Demo (Service Loop)
 *
 * Demonstrates how the SDK handles p2 termination in a long-running service.
 * The service starts a new agent run, and 30 seconds after each run completes
 * (or is terminated), it starts another — each as a fresh agent instance.
 *
 * Termination is scoped to the current run:
 *   - PrefactorTerminatedError is thrown by the middleware when p2 terminates
 *     the active instance.
 *   - The service loop catches it and restarts after a delay.
 *   - Ctrl+C stops the entire service.
 *
 * How termination is detected:
 *   Primary: span create/finish responses carry `control.terminate` when the
 *   instance is terminated. Zero latency — detected on the next span API call.
 *   Fallback: slow poll of `/api/v1/agent_instance/{id}` every 30s for idle
 *   agents that are not actively emitting spans.
 *
 * Usage:
 *   bun run examples/langchain/termination-demo.ts
 *
 *   # Auto-terminate delay in seconds (0 = manual mode)
 *   PREFACTOR_AUTO_TERMINATE_DELAY=8 bun run examples/langchain/termination-demo.ts
 *
 *   # Manual mode — terminate from another terminal during a run
 *   PREFACTOR_AUTO_TERMINATE_DELAY=0 bun run examples/langchain/termination-demo.ts
 *
 * Prerequisites:
 *   - p2 running on localhost:4000
 *   - ANTHROPIC_API_KEY set
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

// These tools capture the abort signal per-run and stop themselves mid-loop
// when terminated.

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

      return factors.length === 0
        ? `${n} is prime`
        : `${n} is composite. Factors found: ${factors.join(', ')}`;
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

// -- Termination helpers --------------------------------------------------

async function terminateInstance(
  apiUrl: string,
  apiToken: string,
  agentInstanceId: string,
  reason: string
): Promise<void> {
  const url = `${apiUrl}/api/v1/agent_instance/${agentInstanceId}/terminate`;
  console.log(`\n  Calling terminate API: POST ${url}`);
  console.log(`  Reason: "${reason}"\n`);

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

  console.log(`  Terminate API: status=${body.status}`);
}

// Schedules an auto-terminate for the current run. Returns a cancel function.
// Waits for a new instance ID (after a null transition) so it doesn't pick up
// a stale ID from the previous run that hasn't been cleared yet.
function scheduleAutoTerminate(
  prefactor: ReturnType<typeof init>,
  apiUrl: string,
  apiToken: string,
  delaySeconds: number,
  isFirstRun: boolean
): () => void {
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  (async () => {
    // On runs after the first, wait for the old instance ID to clear (null)
    // before looking for the new one. This prevents capturing a stale ID.
    if (!isFirstRun) {
      while (!cancelled && prefactor.getAgentInstanceId() !== null) {
        await sleep(100);
      }
    }

    let instanceId: string | null = null;
    while (!instanceId && !cancelled) {
      instanceId = prefactor.getAgentInstanceId();
      if (!instanceId) await sleep(200);
    }
    if (cancelled || !instanceId) return;

    console.log(`  Agent instance: ${instanceId}`);
    console.log(`  Auto-terminate in ${delaySeconds}s...`);

    await sleep(delaySeconds * 1000);
    if (cancelled) return;

    await terminateInstance(apiUrl, apiToken, instanceId, 'automated demo termination').catch(
      (err: unknown) => {
        if (!(err instanceof Error) || !err.message.includes('409')) {
          console.error('  Auto-terminate error:', err);
        }
      }
    );
  })();

  return cancel;
}

// -- Service loop ---------------------------------------------------------

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required.');
  }

  const apiUrl = process.env.PREFACTOR_API_URL || 'http://localhost:4000';
  const apiToken =
    process.env.PREFACTOR_API_TOKEN ||
    'eyJhbGciOiJIUzI1NiIsImtpZCI6IjBhM2M5MzI0OWU5NjJkMWExOTBmMWJkNTE0OGU5YmRkIiwidHlwIjoiSldUIn0.eyJfIjp7ImEiOiIwMWtxZ2ZiMmdrcHpqenA2NzJhMnoycnIzMXptczYzMiIsInQiOiJiYSJ9LCJleHAiOjE4NDA2ODA4NTYsImlhdCI6MTc3NzYwODg1NiwianRpIjoiMDFrcWd2eDUzd3B6anpwNmo5M3pzcmg0amt2c3Q2NW0ifQ.yPAX1MfJuvs5bNGnG9-2mNg727vZeti0kO_BU6tPW7c';
  const autoDelay = parseInt(process.env.PREFACTOR_AUTO_TERMINATE_DELAY ?? '8', 10);
  const restartDelay = parseInt(process.env.PREFACTOR_RESTART_DELAY ?? '30', 10);

  const sep = '='.repeat(72);
  console.log(sep);
  console.log('Prefactor SDK — Termination Demo (Service Loop)');
  console.log(sep);
  console.log(`  API:            ${apiUrl}`);
  console.log(`  Auto-terminate: ${autoDelay > 0 ? `${autoDelay}s` : 'manual'}`);
  console.log(`  Restart delay:  ${restartDelay}s`);
  console.log(`  Ctrl+C to stop the service.`);
  console.log();

  // SDK is initialized once for the lifetime of the service.
  const prefactor = init({
    provider: new PrefactorLangChain(),
    httpConfig: {
      apiUrl,
      apiToken,
      agentId: process.env.PREFACTOR_AGENT_ID || '01kqgvyh4tpzjzp6ape8eq56s9m5nx3s',
      agentIdentifier: 'termination-demo-v1',
      agentSchema: {
        external_identifier: 'termination-demo-schema-v1',
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
              properties: { number: { type: 'number' }, delay_ms: { type: 'number' } },
              required: ['number'],
            },
          },
        },
      },
    },
  });

  const monitor = prefactor.getTerminationMonitor();
  const model = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    anthropicApiUrl: process.env.ANTHROPIC_BASE_URL,
    model: 'claude-haiku-4-5-20251001',
  });

  let runCount = 0;

  process.on('SIGINT', () => {
    console.log('\n  Service stopped (SIGINT). Shutting down...');
    prefactor.shutdown().finally(() => process.exit(0));
  });

  // Service loop: start a new run, handle termination, repeat.
  // biome-ignore lint/correctness/noConstantCondition: intentional service loop
  while (true) {
    runCount++;

    const signal = monitor.signal;

    // Tools must be recreated per run: they capture the run's AbortSignal
    // directly so they can stop in-loop when terminated.
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

    console.log(`${sep}`);
    console.log(`Run #${runCount} — starting`);
    console.log(`${sep}`);

    const query =
      'First check the current time and weather in Tokyo. ' +
      'Then do a countdown from 10. ' +
      'Then check if 9876543221 is prime. ' +
      'Finally tell me the weather in London.';

    console.log(`  Query: "${query}"`);
    console.log();

    let cancelAutoTerminate: (() => void) | null = null;

    try {
      if (autoDelay > 0) {
        cancelAutoTerminate = scheduleAutoTerminate(prefactor, apiUrl, apiToken, autoDelay, runCount === 1);
      } else {
        const instancePoller = setInterval(() => {
          const id = prefactor.getAgentInstanceId();
          if (id) {
            clearInterval(instancePoller);
            console.log(`\n  Run instance: ${id}`);
            console.log(
              `  Manual mode — terminate with:\n` +
                `  curl -XPOST http://localhost:4000/api/v1/agent_instance/${id}/terminate \\\n` +
                `       -H "Authorization: Bearer ${apiToken}" \\\n` +
                `       -H "Content-Type: application/json" \\\n` +
                `       -d '{"reason":"manual test"}'`
            );
          }
        }, 300);
      }

      await agent.invoke({ messages: [{ role: 'user', content: query }] });

      console.log(`\n  Run #${runCount} completed normally.`);
    } catch (err) {
      if (err instanceof Error && err.name === 'PrefactorTerminatedError') {
        console.log(`\n  Run #${runCount} terminated: ${err.message}`);
        console.log(`  Service continues — next run in ${restartDelay}s.`);
      } else {
        // Unexpected error: let it propagate and kill the service.
        throw err;
      }
    } finally {
      cancelAutoTerminate?.();
      // Finish the current instance and reset the monitor for the next run.
      prefactor.finishCurrentRun();
    }

    console.log(`\n  Waiting ${restartDelay}s before next run...`);
    await sleep(restartDelay * 1000);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
