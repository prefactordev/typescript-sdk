import { describe, expect, mock, test } from 'bun:test';
import { TerminationMonitor } from '../../src/monitoring/termination-monitor.js';
import type { HttpRequester } from '../../src/transport/http/http-client.js';

function makeHttpClient(statusOverride?: string): HttpRequester {
  return {
    request: mock(async () => ({
      details: { status: statusOverride ?? 'active' },
    })),
  };
}

function makeTerminatedClient(reason: string | null = null): HttpRequester {
  return {
    request: mock(async () => ({
      details: { status: 'terminated', termination_reason: reason },
    })),
  };
}

describe('TerminationMonitor — primary path (detectTermination)', () => {
  test('fires AbortSignal immediately', () => {
    const monitor = new TerminationMonitor(makeHttpClient(), () => null);

    monitor.detectTermination('user requested stop');

    expect(monitor.signal.aborted).toBe(true);
    expect(monitor.terminated).toBe(true);
    monitor.destroy();
  });

  test('fires callbacks with reason', () => {
    const monitor = new TerminationMonitor(makeHttpClient(), () => null);
    const reasons: (string | null)[] = [];
    monitor.onTerminated((r) => reasons.push(r));

    monitor.detectTermination('reason A');

    expect(reasons).toEqual(['reason A']);
    monitor.destroy();
  });

  test('handles null reason', () => {
    const monitor = new TerminationMonitor(makeHttpClient(), () => null);
    const reasons: (string | null)[] = [];
    monitor.onTerminated((r) => reasons.push(r));

    monitor.detectTermination(null);

    expect(reasons).toEqual([null]);
    expect(monitor.signal.aborted).toBe(true);
    monitor.destroy();
  });

  test('idempotent — second call ignored', () => {
    const monitor = new TerminationMonitor(makeHttpClient(), () => null);
    const reasons: (string | null)[] = [];
    monitor.onTerminated((r) => reasons.push(r));

    monitor.detectTermination('first');
    monitor.detectTermination('second');

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBe('first');
    monitor.destroy();
  });

  test('no-op after destroy()', () => {
    const monitor = new TerminationMonitor(makeHttpClient(), () => null);
    const reasons: (string | null)[] = [];
    monitor.onTerminated((r) => reasons.push(r));

    monitor.destroy();
    monitor.detectTermination('too late');

    expect(reasons).toHaveLength(0);
    expect(monitor.signal.aborted).toBe(false);
  });
});

describe('TerminationMonitor — fallback poll path', () => {
  test('starts polling when instance ID becomes available via sync()', async () => {
    const client = makeTerminatedClient('poll reason');
    const monitor = new TerminationMonitor(client, () => 'instance-1', 50);

    monitor.sync();

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(monitor.signal.aborted).toBe(true);
    expect(client.request).toHaveBeenCalledWith('/api/v1/agent_instance/instance-1');
    monitor.destroy();
  });

  test('stops polling when instance ID disappears', async () => {
    let instanceId: string | null = 'instance-1';
    const client = makeHttpClient('active');
    const monitor = new TerminationMonitor(client, () => instanceId, 50);

    monitor.sync();
    await new Promise((resolve) => setTimeout(resolve, 60));

    instanceId = null;
    monitor.sync();
    const callsAfterStop = (client.request as ReturnType<typeof mock>).mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((client.request as ReturnType<typeof mock>).mock.calls.length).toBe(callsAfterStop);

    monitor.destroy();
  });

  test('does not poll when no instance ID', async () => {
    const client = makeHttpClient('active');
    const monitor = new TerminationMonitor(client, () => null, 50);

    monitor.sync();
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect((client.request as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    monitor.destroy();
  });

  test('stops polling after termination detected', async () => {
    const client = makeTerminatedClient('poll stop');
    const monitor = new TerminationMonitor(client, () => 'instance-x', 50);

    monitor.sync();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const callsAtTermination = (client.request as ReturnType<typeof mock>).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect((client.request as ReturnType<typeof mock>).mock.calls.length).toBe(callsAtTermination);
    monitor.destroy();
  });

  test('poll continues on transient HTTP error', async () => {
    let callCount = 0;
    const client: HttpRequester = {
      request: mock(async () => {
        callCount++;
        if (callCount < 3) throw new Error('network error');
        return { details: { status: 'terminated', termination_reason: 'eventual' } };
      }),
    };
    const reasons: (string | null)[] = [];
    const monitor = new TerminationMonitor(client, () => 'instance-y', 50);
    monitor.onTerminated((r) => reasons.push(r));

    monitor.sync();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(monitor.signal.aborted).toBe(true);
    expect(reasons).toEqual(['eventual']);
    monitor.destroy();
  });
});

describe('TerminationMonitor — reset()', () => {
  test('fresh signal after reset, previous signal unaffected', () => {
    const monitor = new TerminationMonitor(makeHttpClient(), () => null);
    const signalBefore = monitor.signal;

    monitor.reset();
    const signalAfter = monitor.signal;

    expect(signalBefore).not.toBe(signalAfter);
    expect(signalBefore.aborted).toBe(false);
    expect(signalAfter.aborted).toBe(false);
    monitor.destroy();
  });

  test('clears terminated state so detectTermination works again after sync with new instance', () => {
    let instanceId: string | null = 'instance-1';
    const monitor = new TerminationMonitor(makeHttpClient(), () => instanceId);
    const reasons: (string | null)[] = [];
    monitor.onTerminated((r) => reasons.push(r));

    monitor.detectTermination('run 1 stop');
    expect(monitor.terminated).toBe(true);

    monitor.reset();
    expect(monitor.terminated).toBe(false);

    // Fenced until sync() sees a new instance
    monitor.detectTermination('stale — should be ignored');
    expect(reasons).toHaveLength(1);

    instanceId = 'instance-2';
    monitor.sync(); // lifts fence

    monitor.detectTermination('run 2 stop');
    expect(reasons).toEqual(['run 1 stop', 'run 2 stop']);
    monitor.destroy();
  });

  test('signal getter returns new signal after reset', () => {
    const monitor = new TerminationMonitor(makeHttpClient(), () => null);

    monitor.detectTermination('gone');
    const abortedSignal = monitor.signal;

    monitor.reset();
    const freshSignal = monitor.signal;

    expect(abortedSignal.aborted).toBe(true);
    expect(freshSignal.aborted).toBe(false);
    monitor.destroy();
  });

  test('stops fallback polling on reset', async () => {
    const client = makeHttpClient('active');
    const monitor = new TerminationMonitor(client, () => 'instance-1', 50);

    monitor.sync();
    await new Promise((resolve) => setTimeout(resolve, 60));

    monitor.reset();
    const callsAtReset = (client.request as ReturnType<typeof mock>).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect((client.request as ReturnType<typeof mock>).mock.calls.length).toBe(callsAtReset);
    monitor.destroy();
  });

  test('preserves registered callbacks across reset (after fence lifted by sync)', () => {
    let instanceId: string | null = 'instance-1';
    const monitor = new TerminationMonitor(makeHttpClient(), () => instanceId);
    const fired: string[] = [];
    monitor.onTerminated((r) => fired.push(r ?? 'null'));

    monitor.detectTermination('first');
    monitor.reset();
    instanceId = 'instance-2';
    monitor.sync(); // lift fence
    monitor.detectTermination('second');

    expect(fired).toEqual(['first', 'second']);
    monitor.destroy();
  });

  test('detectTermination is blocked (fenced) until sync() sees a new instance after reset', async () => {
    let instanceId: string | null = 'instance-1';
    const monitor = new TerminationMonitor(makeHttpClient(), () => instanceId, 50);

    // First run: detect termination
    monitor.detectTermination('run 1 terminated');
    expect(monitor.terminated).toBe(true);

    // Reset → fenced
    monitor.reset();
    expect(monitor.terminated).toBe(false);

    // detectTermination blocked while fenced (stale span response from run 1)
    monitor.detectTermination('stale signal');
    expect(monitor.terminated).toBe(false);

    // sync() with null instance → still fenced
    instanceId = null;
    monitor.sync();
    monitor.detectTermination('still stale');
    expect(monitor.terminated).toBe(false);

    // sync() with a new instance → fence lifted
    instanceId = 'instance-2';
    monitor.sync();

    // Now detectTermination works for run 2
    monitor.detectTermination('run 2 terminated');
    expect(monitor.terminated).toBe(true);

    monitor.destroy();
  });

  test('lingering old instance ID after reset does not lift the fence or restart polling', async () => {
    let instanceId: string | null = 'instance-1';
    const client = makeHttpClient('active');
    const monitor = new TerminationMonitor(client, () => instanceId, 50);

    monitor.sync();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const callsBeforeReset = (client.request as ReturnType<typeof mock>).mock.calls.length;

    monitor.reset();
    monitor.sync();
    monitor.detectTermination('stale signal');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(monitor.terminated).toBe(false);
    expect((client.request as ReturnType<typeof mock>).mock.calls.length).toBe(callsBeforeReset);

    instanceId = 'instance-2';
    monitor.sync();
    monitor.detectTermination('new run signal');

    expect(monitor.terminated).toBe(true);
    monitor.destroy();
  });

  test('stale poll response after reset does not abort fresh signal', async () => {
    let resolveRequest!: (val: unknown) => void;
    const client: HttpRequester = {
      request: mock(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          })
      ),
    };

    const monitor = new TerminationMonitor(client, () => 'instance-1', 50);
    monitor.sync();
    // Wait for poll to fire and be in-flight
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Reset mid-flight
    monitor.reset();
    const freshSignal = monitor.signal;
    expect(freshSignal.aborted).toBe(false);

    // Resolve the in-flight poll with a terminated response
    resolveRequest({ details: { status: 'terminated', termination_reason: 'stale' } });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Fresh signal must not be aborted — the stale poll result should be discarded
    expect(freshSignal.aborted).toBe(false);
    expect(monitor.terminated).toBe(false);
    monitor.destroy();
  });
});

describe('TerminationMonitor — callback lifecycle', () => {
  test('onTerminated returns unsubscribe', () => {
    const monitor = new TerminationMonitor(makeHttpClient(), () => null);
    const fired: boolean[] = [];
    const unsub = monitor.onTerminated(() => fired.push(true));

    unsub();
    monitor.detectTermination('gone');

    expect(fired).toHaveLength(0);
    monitor.destroy();
  });

  test('subsequent callbacks fire after earlier ones complete', () => {
    const monitor = new TerminationMonitor(makeHttpClient(), () => null);
    const order: number[] = [];
    monitor.onTerminated(() => order.push(1));
    monitor.onTerminated(() => order.push(2));
    monitor.onTerminated(() => order.push(3));

    monitor.detectTermination(null);

    expect(order).toEqual([1, 2, 3]);
    monitor.destroy();
  });
});
