import { describe, expect, spyOn, test } from 'bun:test';
import { AgentInstanceManager } from '../../src/agent/instance-manager';
import type { QueueAction } from '../../src/queue/actions';
import { InMemoryQueue } from '../../src/queue/in-memory';

const createWarnSpy = () => {
  const warnMessages: string[] = [];
  const warnSpy = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnMessages.push(args.map(String).join(' '));
  });

  return { warnMessages, warnSpy };
};

describe('AgentInstanceManager', () => {
  test('enqueues schema registration before agent start with schema payloads', () => {
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {});

    manager.registerSchema({ type: 'object' });
    manager.startInstance({ agentId: 'agent-1' });
    const items = queue.dequeueBatch(10);
    expect(items[0].type).toBe('schema_register');
    if (items[0].type === 'schema_register') {
      expect(items[0].data.schema).toEqual({ type: 'object' });
    }
    expect(items[1].type).toBe('agent_start');
    if (items[1].type === 'agent_start') {
      expect(items[1].data.agentId).toBe('agent-1');
    }
  });

  test('warns and does not enqueue agent start before schema registration', () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {});

    try {
      manager.startInstance({ agentId: 'agent-1' });

      const items = queue.dequeueBatch(10);
      expect(items).toHaveLength(0);
      expect(
        warnMessages.some((message) =>
          message.includes('must be registered before starting an agent instance')
        )
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('allows agent start before schema registration when permitted', () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      allowUnregisteredSchema: true,
    });

    try {
      manager.startInstance({ agentId: 'agent-1' });

      const items = queue.dequeueBatch(10);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('agent_start');
      if (items[0].type === 'agent_start') {
        expect(items[0].data.agentId).toBe('agent-1');
      }
      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('only registers schema once (dedupes)', () => {
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {});

    manager.registerSchema({ type: 'object' });
    manager.registerSchema({ type: 'object' });

    const items = queue.dequeueBatch(10);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('schema_register');
  });

  test('enqueues agent finish', () => {
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {});

    manager.finishInstance();

    const items = queue.dequeueBatch(10);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('agent_finish');
  });
});
