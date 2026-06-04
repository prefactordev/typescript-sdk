/**
 * Simulates linear-agent / Render hang: bad agent id → fatal telemetry → shutdown.
 *
 * Run: bun examples/ai-sdk/fatal-shutdown-simulation.ts
 * Parent should exit within a few seconds (no 12h hang from terminationMonitor interval).
 */

import { init } from '@prefactor/core';
import { PrefactorAISDK } from '@prefactor/ai';
import type { LanguageModelMiddleware } from 'ai';

const SIMULATION_OK = 'SIMULATION_OK';
const SHUTDOWN_DEADLINE_MS = 8_000;

function countTimerHandles(): number {
  const handles =
    (
      process as NodeJS.Process & {
        _getActiveHandles?: () => Array<{ constructor?: { name?: string } }>;
      }
    )._getActiveHandles?.() ?? [];
  return handles.filter((handle) => handle.constructor?.name === 'Timeout').length;
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes('/agent_instance/register')) {
      return new Response(JSON.stringify({ code: 'not_found', message: 'agent not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/agent_instance/') && url.includes('/start')) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/agent_spans')) {
      return new Response(JSON.stringify({ details: { id: 'backend-span-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  const prefactor = init({
    provider: new PrefactorAISDK(),
    httpConfig: {
      apiUrl: 'https://example.com',
      apiToken: 'simulation-token',
      agentId: '01invalidagentid00000000000000',
      agentIdentifier: '1.0.0',
      agentName: 'Fatal shutdown simulation',
      maxRetries: 0,
      initialRetryDelay: 1,
      requestTimeout: 5_000,
    },
    failureHandling: {
      onFatalError: (error) => {
        console.error('[simulation] fatal telemetry:', error.kind, error.operation);
      },
    },
  });

  const middleware = prefactor.getMiddleware() as LanguageModelMiddleware;
  const timersBeforeWork = countTimerHandles();

  try {
    // Same path as examples/ai-sdk/simple-agent.ts: middleware starts agent lifecycle.
    await middleware.wrapGenerate?.({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'simulated' }],
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      }),
      params: {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
      },
      model: {
        modelId: 'simulation-model',
        provider: 'simulation',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
  } catch (error) {
    console.error('[simulation] work phase error (expected):', error);
  }

  const shutdownDeadline = setTimeout(() => {
    console.error(
      `[simulation] shutdown did not finish within ${SHUTDOWN_DEADLINE_MS}ms — process would hang on Render`
    );
    process.exit(2);
  }, SHUTDOWN_DEADLINE_MS);

  let shutdownError: unknown;
  try {
    await prefactor.shutdown();
  } catch (error) {
    shutdownError = error;
  } finally {
    clearTimeout(shutdownDeadline);
    globalThis.fetch = originalFetch;
  }

  const timersAfterShutdown = countTimerHandles();

  if (shutdownError) {
    console.log('[simulation] shutdown rethrew provider error:', shutdownError);
  }

  console.log('[simulation] timers before work:', timersBeforeWork);
  console.log('[simulation] timers after shutdown:', timersAfterShutdown);

  if (timersAfterShutdown > timersBeforeWork) {
    console.error(
      '[simulation] extra active timers after shutdown — termination monitor interval may still be running'
    );
    process.exit(3);
  }

  console.log(SIMULATION_OK);
  process.exit(0);
}

main().catch((error) => {
  console.error('[simulation] unhandled:', error);
  process.exit(1);
});
