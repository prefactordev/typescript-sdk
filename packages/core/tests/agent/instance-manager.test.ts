import { describe, expect, test } from 'bun:test';
import { InMemoryQueue } from '../../src/queue/in-memory';
import { AgentInstanceManager } from '../../src/agent/instance-manager';

describe('AgentInstanceManager', () => {
  test('enqueues schema registration before agent start', () => {
    const queue = new InMemoryQueue();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    manager.registerSchema({ type: 'object' });
    manager.startInstance({ agentId: 'agent-1' });

    const items = queue.dequeueBatch(10);
    expect(items[0].type).toBe('schema_register');
    expect(items[1].type).toBe('agent_start');
  });
});
