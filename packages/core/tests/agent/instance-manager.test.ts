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
    const { warnMessages, warnSpy } = createWarnSpy();
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

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
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
      allowUnregisteredSchema: true,
    });

    try {
      manager.startInstance({ agentId: 'agent-1' });

      const items = queue.dequeueBatch(10);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('agent_start');
      if (items[0].type === 'agent_start') {
        expect(items[0].data.schemaName).toBe('langchain:agent');
        expect(items[0].data.schemaVersion).toBe('1.0.0');
        expect(items[0].data.agentId).toBe('agent-1');
      }
      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
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

  test('does not warn for repeated identical schema registration', () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    try {
      manager.registerSchema({ type: 'object' });
      manager.registerSchema({ type: 'object' });

      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('dedupes schema registration with reordered keys', () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    const schemaA = {
      type: 'object',
      properties: {
        alpha: { type: 'string' },
        beta: { type: 'number' },
      },
    };

    const schemaB = {
      type: 'object',
      properties: {
        beta: { type: 'number' },
        alpha: { type: 'string' },
      },
    };

    try {
      manager.registerSchema(schemaA);
      manager.registerSchema(schemaB);

      const items = queue.dequeueBatch(10);
      expect(items).toHaveLength(1);
      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('does not warn for schema registration with reordered array keywords', () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    const schemaA = {
      type: 'object',
      required: ['alpha', 'beta'],
      enum: ['delta', 'gamma'],
      oneOf: [{ type: 'string' }, { type: 'number' }],
      allOf: [{ const: 'alpha' }, { const: 'beta' }],
      anyOf: [{ minLength: 1 }, { minLength: 2 }],
    };

    const schemaB = {
      type: 'object',
      required: ['beta', 'alpha'],
      enum: ['gamma', 'delta'],
      oneOf: [{ type: 'number' }, { type: 'string' }],
      allOf: [{ const: 'beta' }, { const: 'alpha' }],
      anyOf: [{ minLength: 2 }, { minLength: 1 }],
    };

    try {
      manager.registerSchema(schemaA);
      manager.registerSchema(schemaB);

      const items = queue.dequeueBatch(10);
      expect(items).toHaveLength(1);
      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('does not warn when type arrays are reordered', () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    const schemaA = {
      type: ['null', 'string'],
    };

    const schemaB = {
      type: ['string', 'null'],
    };

    try {
      manager.registerSchema(schemaA);
      manager.registerSchema(schemaB);

      const items = queue.dequeueBatch(10);
      expect(items).toHaveLength(1);
      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('warns and ignores schema registration with different payload', () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const queue = new InMemoryQueue<QueueAction>();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    try {
      manager.registerSchema({ type: 'object' });
      manager.registerSchema({ type: 'object', title: 'Agent' });

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
    } finally {
      warnSpy.mockRestore();
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
