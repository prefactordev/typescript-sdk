import { describe, expect, test } from 'bun:test';
import type { QueueAction } from '../../src/queue/actions';
import { InMemoryQueue } from '../../src/queue/in-memory';
import { AgentInstanceManager } from '../../src/agent/instance-manager';

describe('AgentInstanceManager', () => {
  test('enqueues schema registration before agent start with schema payloads', () => {
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    manager.registerSchema({ type: 'object' });
    manager.startInstance({ agentId: 'agent-1' });
    const items = queue.dequeueBatch(10);
    expect(items[0].type).toBe('schema_register');
    if (items[0].type === 'schema_register') {
      expect(items[0].data.schemaName).toBe('langchain:agent');
      expect(items[0].data.schemaVersion).toBe('1.0.0');
      expect(items[0].data.schema).toEqual({ type: 'object' });
    }
    expect(items[1].type).toBe('agent_start');
    if (items[1].type === 'agent_start') {
      expect(items[1].data.schemaName).toBe('langchain:agent');
      expect(items[1].data.schemaVersion).toBe('1.0.0');
    }
  });

  test('warns and does not enqueue agent start before schema registration', () => {
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map(String).join(' '));
    };

    try {
      manager.startInstance({ agentId: 'agent-1' });
    } finally {
      console.warn = originalWarn;
    }

    const items = queue.dequeueBatch(10);
    expect(items).toHaveLength(0);
    expect(
      warnMessages.some((message) =>
        message.includes('must be registered before starting an agent instance')
      )
    ).toBe(true);
  });

  test('dedupes repeated schema registration', () => {
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    manager.registerSchema({ type: 'object' });
    manager.registerSchema({ type: 'object' });

    const items = queue.dequeueBatch(10);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('schema_register');
    if (items[0].type === 'schema_register') {
      expect(items[0].data.schemaName).toBe('langchain:agent');
      expect(items[0].data.schemaVersion).toBe('1.0.0');
    }
  });

  test('warns and ignores schema registration with different payload', () => {
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnMessages.push(args.map(String).join(' '));
    };

    try {
      manager.registerSchema({ type: 'object' });
      manager.registerSchema({ type: 'object', title: 'Agent' });
    } finally {
      console.warn = originalWarn;
    }

    const items = queue.dequeueBatch(10);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('schema_register');
    if (items[0].type === 'schema_register') {
      expect(items[0].data.schema).toEqual({ type: 'object' });
    }
    expect(
      warnMessages.some((message) =>
        message.includes('Schema langchain:agent@1.0.0 is already registered')
      )
    ).toBe(true);
  });

  test('enqueues agent finish', () => {
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    manager.finishInstance();

    const items = queue.dequeueBatch(10);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('agent_finish');
  });
});
