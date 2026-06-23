import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { AgentInstanceManager, getClient, init } from '@prefactor/core';
import { createSdkHeaderFetchRecorder } from '../../core/tests/shared/sdk-header.js';
import { PrefactorLangChain } from '../src/provider.js';

describe('PrefactorLangChain provider integration', () => {
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await getClient()?.shutdown();
  });

  test('finishes the agent instance when core client shuts down', async () => {
    const { fetch } = createSdkHeaderFetchRecorder();
    globalThis.fetch = fetch;

    const startSpy = spyOn(AgentInstanceManager.prototype, 'startInstance').mockImplementation(
      () => {}
    );
    const finishSpy = spyOn(AgentInstanceManager.prototype, 'finishInstance').mockImplementation(
      () => {}
    );

    try {
      const prefactor = init({
        provider: new PrefactorLangChain(),
        httpConfig: {
          apiUrl: 'https://example.com',
          apiToken: 'token',
        },
      });

      const middleware = prefactor.getMiddleware() as {
        // biome-ignore lint/suspicious/noExplicitAny: LangChain middleware hook typing is dynamic
        beforeAgent?: (state: any) => Promise<void>;
      };
      await middleware.beforeAgent?.({});

      await prefactor.shutdown();

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(finishSpy).toHaveBeenCalledTimes(1);
    } finally {
      startSpy.mockRestore();
      finishSpy.mockRestore();
    }
  });
});
