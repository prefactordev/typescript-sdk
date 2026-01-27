import { describe, expect, spyOn, test } from 'bun:test';
import type { QueueAction } from '../src/queue/actions.js';
import { InMemoryQueue } from '../src/queue/in-memory.js';
import { createCore } from '../src/create-core.js';
import { createConfig } from '../src/config.js';

const createWarnSpy = () => {
  const warnMessages: string[] = [];
  const warnSpy = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnMessages.push(args.map(String).join(' '));
  });

  return { warnMessages, warnSpy };
};

const getQueue = (core: ReturnType<typeof createCore>): InMemoryQueue<QueueAction> => {
  return (core.agentManager as unknown as { queue: InMemoryQueue<QueueAction> }).queue;
};

describe('createCore', () => {
  test('requires agentVersion when using HTTP transport', () => {
    const config = createConfig({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
      },
    });

    expect(() => createCore(config)).toThrowError(/agentVersion/);
  });

  test('allows agent start before schema registration when skipSchema is true', async () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const config = createConfig({
      transportType: 'stdio',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
        skipSchema: true,
      },
    });
    const core = createCore(config);

    try {
      core.agentManager.startInstance({ agentId: 'agent-1' });

      const items = getQueue(core).dequeueBatch(10);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('agent_start');
      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      await core.shutdown();
    }
  });

  test('allows agent start before schema registration when agentSchema is provided', async () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const config = createConfig({
      transportType: 'stdio',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
        agentSchema: { type: 'object' },
      },
    });
    const core = createCore(config);

    try {
      core.agentManager.startInstance({ agentId: 'agent-1' });

      const items = getQueue(core).dequeueBatch(10);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('agent_start');
      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      await core.shutdown();
    }
  });
});
