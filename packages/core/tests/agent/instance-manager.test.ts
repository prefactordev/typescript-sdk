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
    }
    expect(items[1].type).toBe('agent_start');
    if (items[1].type === 'agent_start') {
      expect(items[1].data.schemaName).toBe('langchain:agent');
      expect(items[1].data.schemaVersion).toBe('1.0.0');
    }
  });

  test('does not enqueue agent start before schema registration', () => {
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    manager.startInstance({ agentId: 'agent-1' });

    const items = queue.dequeueBatch(10);
    expect(items).toHaveLength(0);
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
