import { describe, expect, spyOn, test } from 'bun:test';
import { AgentInstanceManager } from '../../src/agent/instance-manager.js';
import type { Span } from '../../src/tracing/span.js';
import type { AgentInstanceOptions, Transport } from '../../src/transport/http.js';

class MockTransport implements Transport {
  emitted: Span[] = [];
  finished: Array<{ spanId: string; endTime: number }> = [];
  startedInstances: AgentInstanceOptions[] = [];
  finishedInstances = 0;
  registeredSchemas: Record<string, unknown>[] = [];

  emit(span: Span): void {
    this.emitted.push(span);
  }

  finishSpan(spanId: string, endTime: number): void {
    this.finished.push({ spanId, endTime });
  }

  startAgentInstance(options?: AgentInstanceOptions): void {
    this.startedInstances.push(options ?? {});
  }

  finishAgentInstance(): void {
    this.finishedInstances += 1;
  }

  registerSchema(schema: Record<string, unknown>): void {
    this.registeredSchemas.push(schema);
  }

  async close(): Promise<void> {}
}

const createWarnSpy = () => {
  const warnMessages: string[] = [];
  const warnSpy = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnMessages.push(args.map(String).join(' '));
  });

  return { warnMessages, warnSpy };
};

describe('AgentInstanceManager', () => {
  test('registers schema via transport before agent start with schema payloads', () => {
    const transport = new MockTransport();
    const manager = new AgentInstanceManager(transport, {});

    manager.registerSchema({ type: 'object' });
    manager.startInstance({ agentId: 'agent-1' });
    expect(transport.registeredSchemas).toEqual([{ type: 'object' }]);
    expect(transport.startedInstances).toEqual([{ agentId: 'agent-1' }]);
  });

  test('warns and does not start agent before schema registration', () => {
    const { warnMessages, warnSpy } = createWarnSpy();
    const transport = new MockTransport();
    const manager = new AgentInstanceManager(transport, {});

    try {
      manager.startInstance({ agentId: 'agent-1' });

      expect(transport.startedInstances).toHaveLength(0);
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
    const transport = new MockTransport();
    const manager = new AgentInstanceManager(transport, {
      allowUnregisteredSchema: true,
    });

    try {
      manager.startInstance({ agentId: 'agent-1' });

      expect(transport.startedInstances).toHaveLength(1);
      expect(transport.startedInstances[0]).toEqual({ agentId: 'agent-1' });
      expect(warnMessages).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('only registers schema once (dedupes)', () => {
    const transport = new MockTransport();
    const manager = new AgentInstanceManager(transport, {});

    manager.registerSchema({ type: 'object' });
    manager.registerSchema({ type: 'object' });

    expect(transport.registeredSchemas).toHaveLength(1);
  });

  test('finishes agent instance via transport', () => {
    const transport = new MockTransport();
    const manager = new AgentInstanceManager(transport, {});

    manager.finishInstance();

    expect(transport.finishedInstances).toBe(1);
  });
});
